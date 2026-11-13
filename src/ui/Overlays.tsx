import { useEffect } from 'react';
import type { Simulation } from '../sim/simulation';
import { fmtMoney } from './format';

export function Toasts({ sim }: { sim: Simulation }) {
  const top = sim.toasts[0];
  // auto-dismiss the oldest toast a few seconds after it appears
  useEffect(() => {
    if (!top) return;
    const h = window.setTimeout(() => sim.dismissToast(top.id), 3500);
    return () => window.clearTimeout(h);
  }, [sim, top]);
  return (
    <div className="toasts" aria-live="polite">
      {sim.toasts.map((t) => (
        <div key={t.id} className={`toast ${t.kind}`} onClick={() => sim.dismissToast(t.id)}>
          {t.text}
        </div>
      ))}
    </div>
  );
}

interface RoundOverProps {
  sim: Simulation;
  best?: number;
  newBest: boolean;
  onAgain: () => void;
  onClose: () => void;
}

export function RoundOver({ sim, best, newBest, onAgain, onClose }: RoundOverProps) {
  const r = sim.result!;
  return (
    <div className="modal-bg" role="dialog" aria-modal="true" aria-labelledby="ro-title">
      <div className="modal">
        <h2 id="ro-title" className={r.hit ? 'mineclr' : ''}>
          {r.hit ? 'Target hit' : 'Round over'}
        </h2>
        <div style={{ color: 'var(--muted)' }}>
          {sim.scenario.name} · {sim.scenario.challenge.title}
        </div>
        <div className="stats">
          <div>
            <div className="lbl">Net P&amp;L</div>
            <div className={`v num ${r.net >= 0 ? 'up' : 'dn'}`}>{fmtMoney(r.net)}</div>
          </div>
          <div>
            <div className="lbl">Score</div>
            <div className="v num mineclr">{r.score.toLocaleString('en-US')}</div>
          </div>
          <div>
            <div className="lbl">Fills</div>
            <div className="v num">{r.trades}</div>
          </div>
          <div>
            <div className="lbl">{newBest ? 'New best' : 'Best'}</div>
            <div className="v num">{best !== undefined ? best.toLocaleString('en-US') : '—'}</div>
          </div>
        </div>
        <div style={{ fontSize: 12, color: 'var(--muted)' }}>
          Open positions are marked at the last price. Reaching the target adds 1,000 points.
        </div>
        <div className="actions">
          <button onClick={onClose}>Review the round</button>
          <button className="primary" onClick={onAgain} autoFocus>
            Play again
          </button>
        </div>
      </div>
    </div>
  );
}
