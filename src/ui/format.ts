import { SESSION_EPOCH_SEC, fmtPrice } from '../sim/simulation';

export { fmtPrice };

export const fmtMoney = (n: number, sign = true) => {
  const s = Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (!sign) return `$${s}`;
  if (Math.abs(n) < 0.005) return `$${s}`;
  return `${n > 0 ? '+' : '−'}$${s}`;
};

export const pnlClass = (n: number) => (n > 0.005 ? 'up' : n < -0.005 ? 'dn' : '');

const pad = (n: number, w = 2) => String(Math.floor(n)).padStart(w, '0');

/** Wall clock for an absolute time in seconds (UTC, which is the sim's display zone). */
export const fmtClock = (sec: number, ms = false) => {
  const d = ((sec % 86400) + 86400) % 86400;
  const base = `${pad(d / 3600)}:${pad((d % 3600) / 60)}:${pad(d % 60)}`;
  return ms ? `${base}.${pad((sec * 1000) % 1000, 3)}` : base;
};

/** Sim ms since session start → clock text. */
export const fmtSimTime = (simMs: number, ms = false) => fmtClock(SESSION_EPOCH_SEC + simMs / 1000, ms);

export const fmtCountdown = (sec: number) => `${pad(sec / 60)}:${pad(sec % 60)}`;
