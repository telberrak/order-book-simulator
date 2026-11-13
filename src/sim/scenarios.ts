export interface Challenge {
  title: string;
  /** Net P&L target in dollars. */
  target: number;
  /** Largest position (and worst-case working exposure) allowed, in lots. */
  maxLots: number;
  /** Length of the round in sim seconds. */
  durationSec: number;
}

export interface Scenario {
  id: string;
  name: string;
  blurb: string;
  /** Fair value volatility, in ticks per sqrt(second). */
  vol: number;
  /** Fair value drift in ticks per second. Sign is randomised per game when `randomDriftSign`. */
  drift: number;
  randomDriftSign?: boolean;
  /** Chance per second of a sudden fair value jump, and its size range in ticks. */
  jumpRate: number;
  jumpTicks: [number, number];
  /** A scheduled shock: at `atSec` into the round, fair value jumps by `ticks` (random sign) and vol is multiplied. */
  shock?: { atSec: number; ticks: [number, number]; volAfter: number; label: string };
  /** Market maker settings. */
  makers: number;
  makerLevels: number;
  makerSize: [number, number];
  makerHalfSpread: number; // ticks from fair value to the first quote
  /** Market order flow, orders per second. */
  takerRate: number;
  /** Share of taker flow that trades in the direction of fair value. */
  informed: number;
  /** Background limit orders per second. */
  noiseRate: number;
  spoofer?: boolean;
  challenge: Challenge;
}

export const SCENARIOS: Scenario[] = [
  {
    id: 'quiet',
    name: 'Quiet open',
    blurb: 'Deep book, gentle flow. Learn to work the bid and the offer.',
    vol: 0.8,
    drift: 0,
    jumpRate: 0.002,
    jumpTicks: [3, 6],
    makers: 4,
    makerLevels: 14,
    makerSize: [12, 40],
    makerHalfSpread: 0.5,
    takerRate: 2.2,
    informed: 0.55,
    noiseRate: 2,
    challenge: { title: 'Make $500 · max 5 lots', target: 500, maxLots: 5, durationSec: 480 },
  },
  {
    id: 'fed',
    name: 'Fed minutes spike',
    blurb: 'Calm tape until the minutes drop at 2:30, then the market reprices fast.',
    vol: 0.6,
    drift: 0,
    jumpRate: 0.003,
    jumpTicks: [3, 8],
    shock: { atSec: 150, ticks: [40, 70], volAfter: 2.2, label: 'Fed minutes released' },
    makers: 4,
    makerLevels: 14,
    makerSize: [10, 36],
    makerHalfSpread: 0.5,
    takerRate: 2.6,
    informed: 0.6,
    noiseRate: 2,
    challenge: { title: 'Make $2,500 · max 10 lots', target: 2500, maxLots: 10, durationSec: 600 },
  },
  {
    id: 'crunch',
    name: 'Liquidity crunch',
    blurb: 'Thin book and wide spreads. Market orders hurt; be patient.',
    vol: 1.1,
    drift: 0,
    jumpRate: 0.01,
    jumpTicks: [4, 10],
    makers: 2,
    makerLevels: 10,
    makerSize: [2, 10],
    makerHalfSpread: 2,
    takerRate: 1.4,
    informed: 0.55,
    noiseRate: 1,
    challenge: { title: 'Make $1,000 · max 5 lots', target: 1000, maxLots: 5, durationSec: 480 },
  },
  {
    id: 'spoof',
    name: 'Spoofer in the book',
    blurb: 'A huge order keeps appearing near the touch and vanishes when price gets close.',
    vol: 0.7,
    drift: 0.05,
    randomDriftSign: true,
    jumpRate: 0.003,
    jumpTicks: [3, 6],
    makers: 4,
    makerLevels: 14,
    makerSize: [10, 34],
    makerHalfSpread: 0.5,
    takerRate: 2.4,
    informed: 0.58,
    noiseRate: 2,
    spoofer: true,
    challenge: { title: 'Make $2,000 · max 8 lots', target: 2000, maxLots: 8, durationSec: 540 },
  },
  {
    id: 'trend',
    name: 'Trend day',
    blurb: 'One-way pressure all session. Find the direction and stay with it.',
    vol: 0.7,
    drift: 0.09,
    randomDriftSign: true,
    jumpRate: 0.004,
    jumpTicks: [3, 8],
    makers: 4,
    makerLevels: 14,
    makerSize: [10, 36],
    makerHalfSpread: 0.5,
    takerRate: 2.6,
    informed: 0.62,
    noiseRate: 2,
    challenge: { title: 'Make $3,000 · max 10 lots', target: 3000, maxLots: 10, durationSec: 600 },
  },
];

export const scenarioById = (id: string) => SCENARIOS.find((s) => s.id === id) ?? SCENARIOS[0];
