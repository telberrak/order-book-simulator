import { OrderBook } from '../engine/orderBook';
import { Position } from '../engine/position';
import { CandleBuilder } from '../engine/candles';
import type { Side, Trade } from '../engine/types';
import { Rng } from './random';
import type { Scenario } from './scenarios';

// ---- contract spec (fictional index future) ----
export const SYMBOL = 'NVX·DEC';
export const TICK_SIZE = 0.25;
export const POINT_VALUE = 50;
export const TICK_VALUE = TICK_SIZE * POINT_VALUE; // $12.50
export const COMMISSION_PER_LOT = 2;
export const TIMEFRAMES = [5, 15, 60, 300] as const;
export const PLAYER = 'player';

const STEP_MS = 100;
const WARMUP_SEC = 600;
/** Sim time 0 is 14:20:00 UTC on an arbitrary date; the round starts after the warm-up at 14:30:00. */
export const SESSION_EPOCH_SEC = Date.UTC(2026, 0, 6, 14, 20, 0) / 1000;
const START_PRICE_TICKS = Math.round(4800 / TICK_SIZE);
const MAX_TAPE = 300;
const MAX_STEPS_PER_ADVANCE = 200;

export const toPrice = (ticks: number) => ticks * TICK_SIZE;
export const toTicks = (price: number) => Math.round(price / TICK_SIZE);

export type GameStatus = 'running' | 'paused' | 'ended';
export type PlayerOrderKind = 'limit' | 'market' | 'stop';

export interface PlayerOrderInput {
  side: Side;
  kind: PlayerOrderKind;
  /** Price in ticks for limit and stop orders. */
  price?: number;
  qty: number;
  tif?: 'GTC' | 'IOC';
}

export interface StopOrder {
  id: number;
  side: Side;
  stop: number; // ticks
  qty: number;
  time: number;
}

export interface PlayerFill {
  id: number;
  time: number;
  side: Side;
  price: number; // ticks
  qty: number;
  liquidity: 'Maker' | 'Taker';
  /** Realized P&L from this fill, in dollars, before commission. */
  realized: number;
}

export interface PlayerOrderView {
  id: number;
  time: number;
  side: Side;
  kind: 'LMT' | 'STP';
  price: number;
  qty: number;
  filled: number;
  remaining: number;
  queue: number;
  status: 'Working' | 'Partial' | 'Armed';
}

export interface Toast {
  id: number;
  kind: 'fill' | 'reject' | 'info' | 'event';
  text: string;
}

export interface LadderRow {
  price: number;
  bid: number;
  ask: number;
  myBid: number;
  myAsk: number;
  myStop: number;
}

export interface RoundResult {
  net: number;
  target: number;
  hit: boolean;
  score: number;
  trades: number;
}

interface Maker {
  name: string;
  inv: number;
  orders: Set<number>;
}

export class Simulation {
  readonly book = new OrderBook();
  readonly candles = new CandleBuilder([...TIMEFRAMES]);
  readonly player = new Position();
  readonly rng: Rng;

  status: GameStatus = 'running';
  speed = 1;
  /** Sim time in ms since SESSION_EPOCH_SEC. */
  timeMs = 0;
  readonly roundStartMs = WARMUP_SEC * 1000;
  roundOpen = START_PRICE_TICKS;

  last = START_PRICE_TICKS;
  lastDir: 1 | -1 | 0 = 0;
  tape: Trade[] = [];
  fills: PlayerFill[] = [];
  stops: StopOrder[] = [];
  commissions = 0;
  toasts: Toast[] = [];
  result?: RoundResult;
  sessionVolume = 0;
  /** Share of recent volume that lifted the offer (0..1). */
  buyShare = 0.5;

  /** Bumped whenever something visible changes. */
  version = 0;

  private fv: number;
  private volMult = 1;
  private driftSign = 1;
  private shockFired = false;
  private makers: Maker[] = [];
  private makerByOrder = new Map<number, Maker>();
  private noise: { id: number; expire: number }[] = [];
  private spoof: { id?: number; nextAt: number; until: number } = { nextAt: 0, until: 0 };
  private acc = 0;
  private nextStopId = 1_000_000;
  private nextToastId = 1;
  private listeners = new Set<() => void>();
  private recentBuy = 0;
  private recentAll = 0;

  constructor(readonly scenario: Scenario, readonly seed = (Math.random() * 2 ** 32) >>> 0) {
    this.rng = new Rng(seed);
    this.fv = START_PRICE_TICKS + this.rng.range(-4, 4);
    if (scenario.randomDriftSign) this.driftSign = this.rng.chance(0.5) ? 1 : -1;
    for (let i = 0; i < scenario.makers; i++) this.makers.push({ name: `mm${i + 1}`, inv: 0, orders: new Set() });
    // Warm up so the book, tape and chart have history before the round starts.
    while (this.timeMs < this.roundStartMs) this.step();
    this.roundOpen = this.last;
    this.toast('info', `${scenario.name}: ${scenario.challenge.title}`);
  }

  // ---------------------------------------------------------------- subscription
  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };
  getVersion = () => this.version;
  private emit() {
    this.version++;
    for (const l of this.listeners) l();
  }

  // ---------------------------------------------------------------- clock
  /** Seconds elapsed in the round (0 during warm-up). */
  get roundElapsed() {
    return Math.max(0, (this.timeMs - this.roundStartMs) / 1000);
  }
  get timeLeft() {
    return Math.max(0, this.scenario.challenge.durationSec - this.roundElapsed);
  }
  get clockSec() {
    return SESSION_EPOCH_SEC + this.timeMs / 1000;
  }

  setSpeed(s: number) {
    this.speed = s;
    this.emit();
  }
  togglePause() {
    if (this.status === 'ended') return;
    this.status = this.status === 'running' ? 'paused' : 'running';
    this.emit();
  }

  /** Advance by real elapsed milliseconds (scaled by speed). */
  advance(realMs: number) {
    if (this.status !== 'running') return;
    this.acc += realMs * this.speed;
    let n = 0;
    while (this.acc >= STEP_MS && n < MAX_STEPS_PER_ADVANCE && this.status === 'running') {
      this.acc -= STEP_MS;
      this.step();
      n++;
      if (this.timeLeft <= 0) this.endRound();
    }
    if (n >= MAX_STEPS_PER_ADVANCE) this.acc = 0;
    if (n) this.emit();
  }

  // ---------------------------------------------------------------- one sim step
  private step() {
    const dt = STEP_MS / 1000;
    const sc = this.scenario;
    const r = this.rng;
    this.timeMs += STEP_MS;
    const inRound = this.timeMs > this.roundStartMs;

    // 1. fair value
    this.fv += sc.drift * this.driftSign * dt + sc.vol * this.volMult * Math.sqrt(dt) * r.gauss();
    if (r.chance(sc.jumpRate * dt)) this.fv += (r.chance(0.5) ? 1 : -1) * r.range(sc.jumpTicks[0], sc.jumpTicks[1]);
    if (sc.shock && inRound && !this.shockFired && this.roundElapsed >= sc.shock.atSec) {
      this.shockFired = true;
      const dir = r.chance(0.5) ? 1 : -1;
      this.fv += dir * r.range(sc.shock.ticks[0], sc.shock.ticks[1]);
      this.volMult = sc.shock.volAfter;
      this.toast('event', `${sc.shock.label}`);
    }
    // calm down slowly after a shock
    if (this.volMult > 1) this.volMult = Math.max(1, this.volMult - dt * 0.004);

    // 2. market makers
    for (const m of this.makers) if (r.chance(0.35)) this.requote(m);

    // 3. background limit orders and their expiry
    for (let i = r.poisson(sc.noiseRate * dt); i > 0; i--) this.placeNoise();
    if (this.noise.length) {
      const keep: typeof this.noise = [];
      for (const n of this.noise) {
        if (n.expire <= this.timeMs) this.book.cancel(n.id);
        else if (this.book.get(n.id)) keep.push(n);
      }
      this.noise = keep;
    }

    // 4. spoofer
    if (sc.spoofer) this.runSpoofer();

    // 5. market order flow
    for (let i = r.poisson(sc.takerRate * this.flowMult() * dt); i > 0; i--) this.placeTaker();

    // decay of the buy/sell share used in the tape header
    this.recentBuy *= 0.995;
    this.recentAll *= 0.995;
    this.buyShare = this.recentAll > 0 ? this.recentBuy / this.recentAll : 0.5;
  }

  private flowMult() {
    return 0.6 + 0.4 * this.volMult;
  }

  private mid(): number {
    const b = this.book.bestBid();
    const a = this.book.bestAsk();
    if (b !== undefined && a !== undefined) return (a + b) / 2;
    return b ?? a ?? this.last;
  }

  private requote(m: Maker) {
    const sc = this.scenario;
    const skew = m.inv * 0.04;
    const center = this.fv - skew;
    const bidTop = Math.floor(center - sc.makerHalfSpread);
    const askTop = Math.max(bidTop + 1, Math.ceil(center + sc.makerHalfSpread));
    const L = sc.makerLevels;
    const want = new Set<number>();
    for (let i = 0; i < L; i++) {
      want.add(-(bidTop - i)); // negative keys = bids
      want.add(askTop + i);
    }
    // cancel stale quotes, remember which levels we still hold
    const have = new Set<number>();
    for (const id of [...m.orders]) {
      const o = this.book.get(id);
      if (!o) {
        m.orders.delete(id);
        this.makerByOrder.delete(id);
        continue;
      }
      const key = o.side === 'buy' ? -o.price : o.price;
      if (!want.has(key) || have.has(key)) {
        this.book.cancel(id);
        m.orders.delete(id);
        this.makerByOrder.delete(id);
      } else have.add(key);
    }
    // post-only: never cross the current book
    const bestAsk = this.book.bestAsk();
    const bestBid = this.book.bestBid();
    for (let i = 0; i < L; i++) {
      const size = Math.round(this.rng.int(sc.makerSize[0], sc.makerSize[1]) * (1 + i * 0.08));
      const bp = bidTop - i;
      if (!have.has(-bp) && (bestAsk === undefined || bp < bestAsk) && this.rng.chance(0.85)) this.makerPlace(m, 'buy', bp, size);
      const ap = askTop + i;
      if (!have.has(ap) && (bestBid === undefined || ap > bestBid) && this.rng.chance(0.85)) this.makerPlace(m, 'sell', ap, size);
    }
  }

  private makerPlace(m: Maker, side: Side, price: number, qty: number) {
    const res = this.book.submit({ owner: m.name, side, type: 'limit', price, qty }, this.timeMs);
    if (res.trades.length) this.onTrades(res.trades);
    if (res.order.remaining > 0 && this.book.get(res.order.id)) {
      m.orders.add(res.order.id);
      this.makerByOrder.set(res.order.id, m);
    }
  }

  private placeNoise() {
    const r = this.rng;
    const side: Side = r.chance(0.5) ? 'buy' : 'sell';
    const ref = side === 'buy' ? this.book.bestBid() : this.book.bestAsk();
    const base = ref ?? Math.round(this.fv);
    const price = side === 'buy' ? base - r.int(0, 8) : base + r.int(0, 8);
    const res = this.book.submit({ owner: 'noise', side, type: 'limit', price, qty: r.int(1, 15) }, this.timeMs);
    if (res.trades.length) this.onTrades(res.trades);
    if (this.book.get(res.order.id)) this.noise.push({ id: res.order.id, expire: this.timeMs + r.int(5, 60) * 1000 });
  }

  private placeTaker() {
    const r = this.rng;
    const m = this.mid();
    let side: Side;
    if (r.chance(this.scenario.informed) && Math.abs(this.fv - m) > 0.3) side = this.fv > m ? 'buy' : 'sell';
    else side = r.chance(0.5) ? 'buy' : 'sell';
    const qty = r.chance(0.04) ? r.int(15, 50) : Math.min(14, 1 + Math.floor(-Math.log(Math.max(1e-9, r.next())) * 2.2));
    const res = this.book.submit({ owner: 'taker', side, type: 'market', qty }, this.timeMs);
    if (res.trades.length) this.onTrades(res.trades);
  }

  private runSpoofer() {
    const r = this.rng;
    // The spoofer leans against the real direction: fake offers in an up-drift, fake bids in a down-drift.
    const side: Side = this.driftSign > 0 ? 'sell' : 'buy';
    const s = this.spoof;
    if (s.id !== undefined) {
      const o = this.book.get(s.id);
      const touch = side === 'sell' ? this.book.bestAsk() : this.book.bestBid();
      const close = o && touch !== undefined && Math.abs(o.price - touch) <= 1;
      if (!o || close || this.timeMs >= s.until) {
        if (o) this.book.cancel(s.id);
        s.id = undefined;
        s.nextAt = this.timeMs + r.int(2, 6) * 1000;
      }
      return;
    }
    if (this.timeMs < s.nextAt) return;
    const touch = side === 'sell' ? this.book.bestAsk() : this.book.bestBid();
    if (touch === undefined) return;
    const price = side === 'sell' ? touch + r.int(2, 4) : touch - r.int(2, 4);
    const res = this.book.submit({ owner: 'spoof', side, type: 'limit', price, qty: r.int(250, 450) }, this.timeMs);
    if (res.trades.length) this.onTrades(res.trades);
    if (this.book.get(res.order.id)) {
      s.id = res.order.id;
      s.until = this.timeMs + r.int(8, 25) * 1000;
    }
  }

  // ---------------------------------------------------------------- trades
  private onTrades(trades: Trade[]) {
    for (const t of trades) {
      if (t.price !== this.last) this.lastDir = t.price > this.last ? 1 : -1;
      this.last = t.price;
      this.tape.push(t);
      this.sessionVolume += t.qty;
      this.recentAll += t.qty;
      if (t.aggressor === 'buy') this.recentBuy += t.qty;
      this.candles.add(this.timeMs / 1000 + SESSION_EPOCH_SEC, toPrice(t.price), t.qty, t.aggressor === 'buy');
      const mk = this.makerByOrder.get(t.makerOrderId);
      if (mk) {
        mk.inv += t.aggressor === 'buy' ? -t.qty : t.qty;
        if (!this.book.get(t.makerOrderId)) {
          mk.orders.delete(t.makerOrderId);
          this.makerByOrder.delete(t.makerOrderId);
        }
      }
      if (t.makerOwner === PLAYER) this.playerFill(t, t.aggressor === 'buy' ? 'sell' : 'buy', 'Maker');
      if (t.takerOwner === PLAYER) this.playerFill(t, t.aggressor, 'Taker');
    }
    if (this.tape.length > MAX_TAPE) this.tape.splice(0, this.tape.length - MAX_TAPE);
    this.checkStops();
  }

  private playerFill(t: Trade, side: Side, liquidity: 'Maker' | 'Taker') {
    const before = this.player.realized;
    this.player.apply(side, t.price, t.qty);
    this.commissions += t.qty * COMMISSION_PER_LOT;
    const realized = (this.player.realized - before) * TICK_VALUE;
    this.fills.unshift({ id: t.id, time: this.timeMs, side, price: t.price, qty: t.qty, liquidity, realized });
    this.toast('fill', `${side === 'buy' ? 'Bought' : 'Sold'} ${t.qty} @ ${fmtPrice(t.price)}`);
  }

  private checkStops() {
    if (!this.stops.length) return;
    const hit = this.stops.filter((s) => (s.side === 'buy' ? this.last >= s.stop : this.last <= s.stop));
    if (!hit.length) return;
    this.stops = this.stops.filter((s) => !hit.includes(s));
    for (const s of hit) {
      this.toast('info', `Stop ${s.side} ${s.qty} @ ${fmtPrice(s.stop)} triggered`);
      const res = this.book.submit({ owner: PLAYER, side: s.side, type: 'market', qty: s.qty }, this.timeMs);
      if (res.trades.length) this.onTrades(res.trades);
    }
  }

  // ---------------------------------------------------------------- player actions
  /** Worst-case position if every working order on `side` filled. */
  exposureAfter(side: Side, qty: number): number {
    let working = 0;
    for (const o of this.book.ordersOf(PLAYER)) if (o.side === side) working += o.remaining;
    for (const s of this.stops) if (s.side === side) working += s.qty;
    return side === 'buy' ? this.player.qty + working + qty : -(this.player.qty - working - qty);
  }

  submit(input: PlayerOrderInput): { ok: boolean; message: string } {
    const reject = (message: string) => {
      this.toast('reject', message);
      this.emit();
      return { ok: false, message };
    };
    if (this.status === 'ended') return reject('The round is over. Start a new one.');
    const qty = Math.floor(input.qty);
    if (!(qty >= 1)) return reject('Size must be at least 1 lot.');
    const max = this.scenario.challenge.maxLots;
    // Only orders that add to exposure are limited; reducing orders always go through.
    const reduces = input.side === 'buy' ? this.player.qty < 0 : this.player.qty > 0;
    if (this.exposureAfter(input.side, qty) > max && !(reduces && qty <= Math.abs(this.player.qty)))
      return reject(`Rejected: that could take you past the ${max}-lot limit.`);

    if (input.kind === 'stop') {
      const p = input.price;
      if (p === undefined) return reject('A stop order needs a price.');
      if (input.side === 'buy' ? p <= this.last : p >= this.last)
        return reject(`A ${input.side} stop must be ${input.side === 'buy' ? 'above' : 'below'} the last price.`);
      this.stops.push({ id: this.nextStopId++, side: input.side, stop: p, qty, time: this.timeMs });
      this.toast('info', `Stop ${input.side} ${qty} @ ${fmtPrice(p)} armed`);
      this.emit();
      return { ok: true, message: 'Stop armed' };
    }

    const res = this.book.submit(
      { owner: PLAYER, side: input.side, type: input.kind, price: input.price, qty, tif: input.tif ?? 'GTC' },
      this.timeMs,
    );
    if (res.status === 'rejected') return reject(res.reason ?? 'Rejected');
    if (res.trades.length) this.onTrades(res.trades);
    if (res.status === 'resting') this.toast('info', `Working ${input.side} ${qty} @ ${fmtPrice(res.order.price)}`);
    if (res.unfilledCancelled > 0)
      this.toast('info', `${res.unfilledCancelled} lot${res.unfilledCancelled > 1 ? 's' : ''} not filled and cancelled`);
    this.emit();
    return { ok: true, message: res.status };
  }

  cancel(id: number) {
    const before = this.stops.length;
    this.stops = this.stops.filter((s) => s.id !== id);
    if (this.stops.length === before) this.book.cancel(id);
    this.emit();
  }

  cancelAtPrice(price: number) {
    for (const o of this.book.ordersOf(PLAYER)) if (o.price === price) this.book.cancel(o.id);
    this.stops = this.stops.filter((s) => s.stop !== price);
    this.emit();
  }

  cancelAll() {
    this.book.cancelAll(PLAYER);
    this.stops = [];
    this.emit();
  }

  flatten() {
    this.cancelAll();
    const q = this.player.qty;
    if (q === 0) return;
    const res = this.book.submit({ owner: PLAYER, side: q > 0 ? 'sell' : 'buy', type: 'market', qty: Math.abs(q) }, this.timeMs);
    if (res.trades.length) this.onTrades(res.trades);
    this.emit();
  }

  private endRound() {
    this.book.cancelAll(PLAYER);
    this.stops = [];
    this.status = 'ended';
    const net = this.netPnl();
    const target = this.scenario.challenge.target;
    this.result = { net, target, hit: net >= target, score: this.score(), trades: this.fills.length };
  }

  // ---------------------------------------------------------------- read models
  openPnl() {
    return this.player.open(this.last) * TICK_VALUE;
  }
  realizedPnl() {
    return this.player.realized * TICK_VALUE;
  }
  netPnl() {
    return this.openPnl() + this.realizedPnl() - this.commissions;
  }
  score() {
    const net = this.netPnl();
    return Math.round(net + (net >= this.scenario.challenge.target ? 1000 : 0));
  }

  playerOrders(): PlayerOrderView[] {
    const out: PlayerOrderView[] = this.book.ordersOf(PLAYER).map((o) => ({
      id: o.id,
      time: o.time,
      side: o.side,
      kind: 'LMT',
      price: o.price,
      qty: o.qty,
      filled: o.filled,
      remaining: o.remaining,
      queue: this.book.queueAhead(o.id),
      status: o.filled > 0 ? 'Partial' : 'Working',
    }));
    for (const s of this.stops)
      out.push({ id: s.id, time: s.time, side: s.side, kind: 'STP', price: s.stop, qty: s.qty, filled: 0, remaining: s.qty, queue: 0, status: 'Armed' });
    return out.sort((a, b) => b.time - a.time);
  }

  /** A contiguous price ladder of `half` levels above and below the middle of the spread. */
  ladder(half: number): LadderRow[] {
    const bb = this.book.bestBid();
    const ba = this.book.bestAsk();
    // put the best ask directly above the middle line
    const top = (ba ?? (bb !== undefined ? bb + 1 : this.last)) + half - 1;
    const mine = new Map<number, { b: number; a: number; s: number }>();
    for (const o of this.book.ordersOf(PLAYER)) {
      const e = mine.get(o.price) ?? { b: 0, a: 0, s: 0 };
      if (o.side === 'buy') e.b += o.remaining;
      else e.a += o.remaining;
      mine.set(o.price, e);
    }
    for (const s of this.stops) {
      const e = mine.get(s.stop) ?? { b: 0, a: 0, s: 0 };
      e.s += s.qty;
      mine.set(s.stop, e);
    }
    const rows: LadderRow[] = [];
    for (let p = top; p > top - half * 2; p--) {
      const sz = this.book.sizeAt(p);
      const m = mine.get(p);
      rows.push({ price: p, bid: sz.bid, ask: sz.ask, myBid: m?.b ?? 0, myAsk: m?.a ?? 0, myStop: m?.s ?? 0 });
    }
    return rows;
  }

  // ---------------------------------------------------------------- toasts
  private toast(kind: Toast['kind'], text: string) {
    this.toasts.push({ id: this.nextToastId++, kind, text });
    if (this.toasts.length > 3) this.toasts.shift();
  }
  dismissToast(id: number) {
    this.toasts = this.toasts.filter((t) => t.id !== id);
    this.emit();
  }
}

export function fmtPrice(ticks: number) {
  return toPrice(ticks).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
