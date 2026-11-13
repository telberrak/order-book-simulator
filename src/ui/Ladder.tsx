import type { MouseEvent } from 'react';
import { toPrice, type Simulation } from '../sim/simulation';
import { fmtPrice } from './format';

const HALF = 12;

interface Props {
  sim: Simulation;
  ticketPrice: number;
  /** Load a price into the ticket; `send` = shift-click to send at once. */
  onPick: (price: number, send: boolean) => void;
}

export function Ladder({ sim, ticketPrice, onPick }: Props) {
  const rows = sim.ladder(HALF);
  const bb = sim.book.bestBid();
  const ba = sim.book.bestAsk();
  const maxQ = Math.max(1, ...rows.map((r) => Math.max(r.bid, r.ask)));
  const totals = sim.book.totals();
  const bidShare = totals.bid + totals.ask > 0 ? totals.bid / (totals.bid + totals.ask) : 0.5;
  const avg = sim.player.qty !== 0 ? Math.round(sim.player.avg) : undefined;

  const cancelAt = (e: MouseEvent, price: number) => {
    e.stopPropagation();
    sim.cancelAtPrice(price);
  };

  const renderRow = (r: (typeof rows)[number]) => {
    const cls = ['lad-row'];
    if (r.myBid || r.myAsk || r.myStop) cls.push('has-mine');
    if (r.price === bb || r.price === ba) cls.push('best');
    if (r.price === sim.last) cls.push('last');
    if (r.price === avg) cls.push('avg');
    if (r.price === ticketPrice) cls.push('ticket-px');
    const badge = (q: number, stop = false) => (
      <button className={stop ? 'stp' : ''} title={`Cancel your ${stop ? 'stop' : 'order'} at ${fmtPrice(r.price)}`} onClick={(e) => cancelAt(e, r.price)}>
        {q}
      </button>
    );
    const leftMine = r.myBid ? badge(r.myBid) : r.myStop && r.price < sim.last ? badge(r.myStop, true) : null;
    const rightMine = r.myAsk ? badge(r.myAsk) : r.myStop && r.price >= sim.last ? badge(r.myStop, true) : null;
    return (
      <div
        key={r.price}
        className={cls.join(' ')}
        tabIndex={0}
        role="button"
        aria-label={`Price ${fmtPrice(r.price)}, bids ${r.bid}, asks ${r.ask}`}
        onClick={(e) => onPick(r.price, e.shiftKey)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onPick(r.price, e.shiftKey);
          }
        }}
      >
        <span className="my">{leftMine}</span>
        <span className="sz bidsz">
          {r.bid > 0 && (
            <>
              <i style={{ width: `${(r.bid / maxQ) * 100}%` }} />
              <b>{r.bid}</b>
            </>
          )}
        </span>
        <span className="px">{fmtPrice(r.price)}</span>
        <span className="sz asksz">
          {r.ask > 0 && (
            <>
              <i style={{ width: `${(r.ask / maxQ) * 100}%` }} />
              <b>{r.ask}</b>
            </>
          )}
        </span>
        <span className="my">{rightMine}</span>
      </div>
    );
  };

  const upper = rows.slice(0, HALF);
  const lower = rows.slice(HALF);
  const spread = bb !== undefined && ba !== undefined ? toPrice(ba - bb) : undefined;
  const mid = bb !== undefined && ba !== undefined ? toPrice((ba + bb) / 2) : undefined;

  return (
    <section className="p ladder" aria-label="Order book">
      <div className="p-h">
        <h2>Order book</h2>
        <span className="aside">
          <span className="num">{sim.book.bids.prices.length + sim.book.asks.prices.length} levels</span>
        </span>
      </div>
      <div className="lad-head">
        <span>Mine</span>
        <span>Bids</span>
        <span>Price</span>
        <span>Asks</span>
        <span>Mine</span>
      </div>
      <div className="lad-body">
        {upper.map(renderRow)}
        <div className="spread">
          <span>
            Spread <span className="num">{spread !== undefined ? spread.toFixed(2) : '—'}</span>
          </span>
          <span>
            Mid <span className="num">{mid !== undefined ? mid.toLocaleString('en-US', { minimumFractionDigits: 3 }) : '—'}</span>
          </span>
          <span>
            Last{' '}
            <span className={`num ${sim.lastDir > 0 ? 'up' : sim.lastDir < 0 ? 'dn' : ''}`}>
              {fmtPrice(sim.last)} {sim.lastDir > 0 ? '↑' : sim.lastDir < 0 ? '↓' : ''}
            </span>
          </span>
        </div>
        {lower.map(renderRow)}
      </div>
      <div className="imb" title={`Book imbalance: bids ${Math.round(bidShare * 100)}%`}>
        <i style={{ width: `${bidShare * 100}%` }} />
        <i />
      </div>
      <div className="hint">Click a price to load it into the ticket. Shift-click sends it at once. Click your amber size to cancel.</div>
      <div className="lad-foot">
        <div>
          <span className="lbl">Bid vol</span>
          <span className="num up">{totals.bid.toLocaleString('en-US')}</span>
        </div>
        <div>
          <span className="lbl">Ask vol</span>
          <span className="num dn">{totals.ask.toLocaleString('en-US')}</span>
        </div>
      </div>
    </section>
  );
}
