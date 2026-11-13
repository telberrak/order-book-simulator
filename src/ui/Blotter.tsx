import { useState } from 'react';
import { toPrice, type Simulation } from '../sim/simulation';
import { fmtMoney, fmtPrice, fmtSimTime, pnlClass } from './format';

export function Blotter({ sim }: { sim: Simulation }) {
  const [tab, setTab] = useState<'orders' | 'fills'>('orders');
  const p = sim.player;
  const open = sim.openPnl();
  const realized = sim.realizedPnl();
  const net = sim.netPnl();
  const orders = sim.playerOrders();
  const fills = sim.fills;

  return (
    <section className="p blotter" aria-label="Blotter">
      <div className="p-h">
        <h2>Blotter</h2>
        <span className="aside num">Fees {fmtMoney(-sim.commissions)}</span>
      </div>
      <div className="pos">
        <div>
          <div className="k">Position</div>
          <div className="v num mineclr">{p.qty === 0 ? 'Flat' : `${p.qty > 0 ? 'Long' : 'Short'} ${Math.abs(p.qty)}`}</div>
        </div>
        <div>
          <div className="k">Avg price</div>
          <div className="v num">{p.qty === 0 ? '—' : toPrice(p.avg).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
        </div>
        <div>
          <div className="k">Open P&amp;L</div>
          <div className={`v num ${pnlClass(open)}`}>{fmtMoney(open)}</div>
        </div>
        <div>
          <div className="k">Realized</div>
          <div className={`v num ${pnlClass(realized)}`}>{fmtMoney(realized)}</div>
        </div>
        <div>
          <div className="k">Net (after fees)</div>
          <div className={`v num ${pnlClass(net)}`}>{fmtMoney(net)}</div>
        </div>
      </div>
      <div className="tabs" role="tablist">
        <button role="tab" aria-selected={tab === 'orders'} onClick={() => setTab('orders')}>
          Open orders<span className="ct">{orders.length}</span>
        </button>
        <button role="tab" aria-selected={tab === 'fills'} onClick={() => setTab('fills')}>
          Fills<span className="ct">{fills.length}</span>
        </button>
      </div>
      {tab === 'orders' ? (
        orders.length ? (
          <div className="tbl-wrap">
            <table>
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Side</th>
                  <th>Type</th>
                  <th className="r">Price</th>
                  <th className="r">Filled / Size</th>
                  <th className="r">Queue ahead</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {orders.map((o) => (
                  <tr key={o.id}>
                    <td>{fmtSimTime(o.time)}</td>
                    <td>
                      <span className={`pill ${o.side}`}>{o.side}</span>
                    </td>
                    <td>{o.kind}</td>
                    <td className="r">{fmtPrice(o.price)}</td>
                    <td className="r">
                      {o.filled} / {o.qty}
                    </td>
                    <td className="r">{o.kind === 'STP' ? '—' : o.queue}</td>
                    <td>
                      <span className={`pill ${o.status === 'Partial' ? 'part' : 'work'}`}>{o.status}</span>
                    </td>
                    <td>
                      <button className="x" aria-label="Cancel order" onClick={() => sim.cancel(o.id)}>
                        ✕
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="empty">No working orders. Click a price on the ladder to start.</div>
        )
      ) : fills.length ? (
        <div className="tbl-wrap">
          <table>
            <thead>
              <tr>
                <th>Time</th>
                <th>Side</th>
                <th className="r">Price</th>
                <th className="r">Size</th>
                <th>Liquidity</th>
                <th className="r">Realized</th>
              </tr>
            </thead>
            <tbody>
              {fills.slice(0, 200).map((f, i) => (
                <tr key={`${f.id}-${i}`}>
                  <td>{fmtSimTime(f.time)}</td>
                  <td>
                    <span className={`pill ${f.side}`}>{f.side}</span>
                  </td>
                  <td className="r">{fmtPrice(f.price)}</td>
                  <td className="r">{f.qty}</td>
                  <td>{f.liquidity}</td>
                  <td className={`r ${pnlClass(f.realized)}`}>{f.realized === 0 ? '—' : fmtMoney(f.realized)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="empty">No fills yet.</div>
      )}
    </section>
  );
}
