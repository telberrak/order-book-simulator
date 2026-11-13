import { SCENARIOS } from '../sim/scenarios';
import { SYMBOL, TICK_SIZE, POINT_VALUE, toPrice, type Simulation } from '../sim/simulation';
import { fmtClock, fmtCountdown, fmtMoney, fmtPrice } from './format';

const SPEEDS = [1, 2, 5, 10];

interface Props {
  sim: Simulation;
  best?: number;
  onScenario: (id: string) => void;
  onNewRound: () => void;
}

export function GameBar({ sim, best, onScenario, onNewRound }: Props) {
  const ch = sim.scenario.challenge;
  const chg = toPrice(sim.last - sim.roundOpen);
  const chgPct = (chg / toPrice(sim.roundOpen)) * 100;
  const dir = chg >= 0 ? 'up' : 'dn';
  const net = sim.netPnl();
  const progress = Math.max(0, Math.min(1, net / ch.target));
  const running = sim.status === 'running';

  return (
    <header className="gamebar" aria-label="Game controls">
      <div className="brand">
        <h1>
          Tape<span>Runner</span>
        </h1>
      </div>
      <div className="instr">
        <span className="sym">{SYMBOL}</span>
        <span className={`px num ${dir}`}>{fmtPrice(sim.last)}</span>
        <span className={`chg num ${dir}`}>
          {chg >= 0 ? '+' : '−'}
          {Math.abs(chg).toFixed(2)} ({chg >= 0 ? '+' : '−'}
          {Math.abs(chgPct).toFixed(2)}%)
        </span>
        <span className="meta num">
          tick {TICK_SIZE} · ${POINT_VALUE}/pt
        </span>
      </div>
      <div className="gb-group">
        <button
          className="playbtn"
          aria-label={running ? 'Pause simulation (P)' : 'Resume simulation (P)'}
          title={running ? 'Pause (P)' : 'Resume (P)'}
          onClick={() => sim.togglePause()}
          disabled={sim.status === 'ended'}
        >
          {running ? (
            <svg viewBox="0 0 10 10">
              <rect x="1" y="0" width="3" height="10" />
              <rect x="6" y="0" width="3" height="10" />
            </svg>
          ) : (
            <svg viewBox="0 0 10 10">
              <path d="M1 0 L10 5 L1 10 Z" />
            </svg>
          )}
        </button>
        <span className="lbl">Speed</span>
        <div className="seg" role="group" aria-label="Simulation speed">
          {SPEEDS.map((s) => (
            <button key={s} aria-pressed={sim.speed === s} onClick={() => sim.setSpeed(s)}>
              {s}×
            </button>
          ))}
        </div>
        {sim.status === 'paused' && <span className="paused-pill">Paused</span>}
      </div>
      <div className="gb-group">
        <label className="lbl" htmlFor="scenario">
          Scenario
        </label>
        <select id="scenario" aria-label="Scenario" value={sim.scenario.id} onChange={(e) => onScenario(e.target.value)} title={sim.scenario.blurb}>
          {SCENARIOS.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        <button className="newround" onClick={onNewRound}>
          New round
        </button>
      </div>
      <div className="gb-group">
        <span className="lbl clock-lbl">Sim clock</span>
        <span className="clock num">{fmtClock(sim.clockSec)}</span>
      </div>
      <div className={`challenge${net >= ch.target ? ' hit' : ''}`}>
        <div className="goal">
          <strong>{ch.title}</strong>
          <span className="num" style={{ color: 'var(--muted)' }}>
            {fmtMoney(net)} / {fmtMoney(ch.target, false)}
          </span>
          <div className="meter">
            <i className={net < 0 ? 'neg' : ''} style={{ width: `${(net < 0 ? Math.min(1, -net / ch.target) : progress) * 100}%` }} />
          </div>
        </div>
        <div className="score">
          <div className="lbl">Score</div>
          <div className="big num">{sim.score().toLocaleString('en-US')}</div>
          <div className="timer num">{fmtCountdown(sim.timeLeft)} left</div>
          {best !== undefined && <div className="best-score num">Best {best.toLocaleString('en-US')}</div>}
        </div>
      </div>
    </header>
  );
}
