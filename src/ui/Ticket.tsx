import { useEffect, useState } from 'react';
import { POINT_VALUE, PLAYER, toPrice, toTicks, type Simulation } from '../sim/simulation';
import { fmtMoney, fmtPrice } from './format';
import type { TicketState } from './ticketState';

interface Props {
  sim: Simulation;
  t: TicketState;
  set: (patch: Partial<TicketState>) => void;
  onSend: () => void;
}

const SIZES = [1, 2, 5, 10];

export function Ticket({ sim, t, set, onSend }: Props) {
  const [priceText, setPriceText] = useState(fmtPrice(t.price));
  const [editing, setEditing] = useState(false);
  useEffect(() => {
    if (!editing) setPriceText(fmtPrice(t.price));
  }, [t.price, editing]);

  const bb = sim.book.bestBid();
  const ba = sim.book.bestAsk();
  const mkt = t.kind === 'market';
  const ended = sim.status === 'ended';
  const max = sim.scenario.challenge.maxLots;

  const commitPrice = () => {
    setEditing(false);
    const n = Number(priceText.replace(/,/g, ''));
    if (Number.isFinite(n) && n > 0) set({ price: toTicks(n) });
    else setPriceText(fmtPrice(t.price));
  };

  const execPx = mkt ? (t.side === 'buy' ? ba : bb) ?? sim.last : t.price;
  const notional = toPrice(execPx) * t.qty * POINT_VALUE;
  const after = sim.player.qty + (t.side === 'buy' ? t.qty : -t.qty);
  const exposure = sim.exposureAfter(t.side, t.qty);

  let queue = '—';
  if (mkt) queue = 'Fills now';
  else if (t.kind === 'stop') queue = 'Triggers on last';
  else {
    const crosses = t.side === 'buy' ? ba !== undefined && t.price >= ba : bb !== undefined && t.price <= bb;
    if (crosses) queue = 'Crosses: fills now';
    else {
      const sz = sim.book.sizeAt(t.price);
      const q = t.side === 'buy' ? sz.bid : sz.ask;
      queue = q ? `${q} lots` : 'Front of queue';
    }
  }

  const label = `${t.side.toUpperCase()} ${t.qty} @ ${mkt ? 'MARKET' : fmtPrice(t.price) + (t.kind === 'stop' ? ' STP' : t.tif === 'IOC' ? ' IOC' : ' LMT')}`;
  const working = sim.book.ordersOf(PLAYER).length + sim.stops.length;

  return (
    <section className="p ticket" aria-label="Order ticket">
      <div className="p-h">
        <h2>Order ticket</h2>
        <span className="aside">Hotkeys B / S</span>
      </div>
      <form
        className="tk"
        onSubmit={(e) => {
          e.preventDefault();
          commitPrice();
          onSend();
        }}
      >
        <div className="side">
          <button type="button" className="buy" aria-pressed={t.side === 'buy'} onClick={() => set({ side: 'buy' })}>
            BUY
          </button>
          <button type="button" className="sell" aria-pressed={t.side === 'sell'} onClick={() => set({ side: 'sell' })}>
            SELL
          </button>
        </div>
        <div className="field">
          <span className="lbl">Order type</span>
          <div className="seg" style={{ alignSelf: 'flex-start' }} role="group" aria-label="Order type">
            {(['limit', 'market', 'stop'] as const).map((k) => (
              <button
                type="button"
                key={k}
                aria-pressed={t.kind === k}
                onClick={() =>
                  // a stop starts 4 ticks beyond the last trade so it is valid straight away
                  set(k === 'stop' && t.kind !== 'stop' ? { kind: k, price: sim.last + (t.side === 'buy' ? 4 : -4) } : { kind: k })
                }
              >
                {k[0].toUpperCase() + k.slice(1)}
              </button>
            ))}
          </div>
        </div>
        <div className="field">
          <label className="lbl" htmlFor="price">
            {t.kind === 'stop' ? 'Stop price' : 'Price'}
          </label>
          <div className="stepper">
            <button type="button" aria-label="Price down one tick" disabled={mkt} onClick={() => set({ price: t.price - 1 })}>
              −
            </button>
            <input
              id="price"
              className="num"
              inputMode="decimal"
              disabled={mkt}
              value={mkt ? 'MKT' : priceText}
              onFocus={() => setEditing(true)}
              onChange={(e) => setPriceText(e.target.value)}
              onBlur={commitPrice}
            />
            <button type="button" aria-label="Price up one tick" disabled={mkt} onClick={() => set({ price: t.price + 1 })}>
              +
            </button>
          </div>
          <div className="chips">
            <button type="button" disabled={bb === undefined} onClick={() => bb !== undefined && set({ price: bb, kind: mkt ? 'limit' : t.kind })}>
              Bid {bb !== undefined ? fmtPrice(bb) : '—'}
            </button>
            <button type="button" disabled={ba === undefined} onClick={() => ba !== undefined && set({ price: ba, kind: mkt ? 'limit' : t.kind })}>
              Ask {ba !== undefined ? fmtPrice(ba) : '—'}
            </button>
            <button type="button" onClick={() => set({ price: sim.last, kind: mkt ? 'limit' : t.kind })}>
              Last
            </button>
          </div>
        </div>
        <div className="field">
          <label className="lbl" htmlFor="qty">
            Size (lots)
          </label>
          <div className="stepper">
            <button type="button" aria-label="Size down" onClick={() => set({ qty: Math.max(1, t.qty - 1) })}>
              −
            </button>
            <input
              id="qty"
              className="num"
              inputMode="numeric"
              value={t.qty}
              onChange={(e) => {
                const n = parseInt(e.target.value.replace(/\D/g, ''), 10);
                set({ qty: Number.isFinite(n) ? Math.max(1, Math.min(999, n)) : 1 });
              }}
            />
            <button type="button" aria-label="Size up" onClick={() => set({ qty: t.qty + 1 })}>
              +
            </button>
          </div>
          <div className="chips">
            {SIZES.map((q) => (
              <button type="button" key={q} onClick={() => set({ qty: q })}>
                {q}
              </button>
            ))}
          </div>
        </div>
        <div className="row2">
          <div className="field">
            <label className="lbl" htmlFor="tif">
              Time in force
            </label>
            <select id="tif" value={t.tif} disabled={t.kind !== 'limit'} onChange={(e) => set({ tif: e.target.value as 'GTC' | 'IOC' })}>
              <option value="GTC">GTC</option>
              <option value="IOC">IOC</option>
            </select>
          </div>
          <div className="field">
            <span className="lbl">Working</span>
            <span className="num" style={{ paddingTop: 5 }}>
              {working} order{working === 1 ? '' : 's'}
            </span>
          </div>
        </div>
        <dl className="summary">
          <dt>Notional</dt>
          <dd className="num">{fmtMoney(notional, false)}</dd>
          <dt>Position after fill</dt>
          <dd className="num mineclr">{after === 0 ? 'Flat' : `${after > 0 ? 'Long' : 'Short'} ${Math.abs(after)}`}</dd>
          <dt>Queue ahead</dt>
          <dd className="num">{queue}</dd>
          <dt>Lot limit (worst case)</dt>
          <dd className={`num ${exposure > max ? 'dn' : ''}`}>
            {Math.max(0, exposure)} / {max} lots
          </dd>
        </dl>
        <button type="submit" className={`submit${t.side === 'sell' ? ' sell' : ''}`} disabled={ended}>
          {label}
        </button>
        <div className="tk-foot">
          <button type="button" onClick={() => sim.cancelAll()}>
            Cancel all
          </button>
          <button type="button" className="danger" onClick={() => sim.flatten()} disabled={sim.player.qty === 0}>
            Flatten
          </button>
        </div>
      </form>
    </section>
  );
}
