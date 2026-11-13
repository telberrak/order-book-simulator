import { PLAYER, type Simulation } from '../sim/simulation';
import { fmtPrice, fmtSimTime } from './format';

const ROWS = 60;
const BIG = 20;

export function Tape({ sim }: { sim: Simulation }) {
  const rows = sim.tape.slice(-ROWS).reverse();
  const buyPct = Math.round(sim.buyShare * 100);
  return (
    <section className="p tape" aria-label="Time and sales">
      <div className="p-h">
        <h2>Time &amp; sales</h2>
        <span className="aside">
          <span className="num">Vol {sim.sessionVolume.toLocaleString('en-US')}</span>
          <span className={`num ${buyPct >= 50 ? 'up' : 'dn'}`}>{buyPct >= 50 ? `Buy ${buyPct}%` : `Sell ${100 - buyPct}%`}</span>
        </span>
      </div>
      <div className="tape-head">
        <span>Time</span>
        <span>Price</span>
        <span style={{ textAlign: 'right' }}>Size</span>
        <span />
      </div>
      <div className="tape-body">
        {rows.map((t) => {
          const mine = t.makerOwner === PLAYER || t.takerOwner === PLAYER;
          const cls = `tape-row ${t.aggressor === 'buy' ? 'b' : 's'}${t.qty >= BIG ? ' big' : ''}${mine ? ' mine' : ''}`;
          return (
            <div key={t.id} className={cls}>
              <span className="t">{fmtSimTime(t.time, true)}</span>
              <span className="pr">{fmtPrice(t.price)}</span>
              <span className="s">{t.qty}</span>
              <span className="tag">{mine ? 'YOU' : ''}</span>
            </div>
          );
        })}
      </div>
    </section>
  );
}
