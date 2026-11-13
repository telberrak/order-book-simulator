import type { LevelView, Order, OrderRequest, Side, SubmitResult, Trade } from './types';

interface Level {
  price: number;
  /** FIFO queue: index 0 is first in line. */
  orders: Order[];
  total: number;
}

/**
 * Sorted price ladder for one side of the book.
 * `prices` is kept sorted best-first (bids descending, asks ascending).
 */
class BookSide {
  readonly levels = new Map<number, Level>();
  readonly prices: number[] = [];
  constructor(readonly side: Side) {}

  /** true if a sorts before b (a is the better price) */
  private better(a: number, b: number) {
    return this.side === 'buy' ? a > b : a < b;
  }

  best(): Level | undefined {
    return this.prices.length ? this.levels.get(this.prices[0]) : undefined;
  }

  getOrCreate(price: number): Level {
    let lvl = this.levels.get(price);
    if (lvl) return lvl;
    lvl = { price, orders: [], total: 0 };
    this.levels.set(price, lvl);
    // binary search insert position
    let lo = 0;
    let hi = this.prices.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.better(this.prices[mid], price)) lo = mid + 1;
      else hi = mid;
    }
    this.prices.splice(lo, 0, price);
    return lvl;
  }

  removeLevel(price: number) {
    this.levels.delete(price);
    const i = this.prices.indexOf(price);
    if (i >= 0) this.prices.splice(i, 1);
  }

  totalQty(): number {
    let s = 0;
    for (const l of this.levels.values()) s += l.total;
    return s;
  }
}

/**
 * Central limit order book with price-time priority.
 *
 * - Limit orders match against the opposite side while they cross, then rest (GTC) or
 *   cancel the leftover (IOC).
 * - Market orders sweep the opposite side until filled or the book is empty; any leftover
 *   is cancelled (a market order never rests).
 * - Trades always print at the resting (maker) order's price.
 */
export class OrderBook {
  readonly bids = new BookSide('buy');
  readonly asks = new BookSide('sell');
  private readonly byId = new Map<number, Order>();
  private nextOrderId = 1;
  private nextTradeId = 1;
  private seq = 0;

  submit(req: OrderRequest, time = 0): SubmitResult {
    const qty = Math.floor(req.qty);
    const order: Order = {
      id: this.nextOrderId++,
      owner: req.owner,
      side: req.side,
      type: req.type,
      price: req.type === 'market' ? 0 : Math.round(req.price ?? NaN),
      qty,
      remaining: qty,
      filled: 0,
      tif: req.type === 'market' ? 'IOC' : req.tif ?? 'GTC',
      seq: 0,
      time,
    };

    if (!(qty > 0)) return { order, trades: [], status: 'rejected', unfilledCancelled: 0, reason: 'Size must be at least 1' };
    if (req.type === 'limit' && !Number.isFinite(order.price))
      return { order, trades: [], status: 'rejected', unfilledCancelled: 0, reason: 'Limit order needs a price' };

    const trades = this.match(order, time);

    if (order.remaining === 0) return { order, trades, status: 'filled', unfilledCancelled: 0 };

    if (order.type === 'market' || order.tif === 'IOC') {
      const left = order.remaining;
      order.remaining = 0;
      return { order, trades, status: 'cancelled', unfilledCancelled: left };
    }

    this.rest(order);
    return { order, trades, status: trades.length ? 'partial-resting' : 'resting', unfilledCancelled: 0 };
  }

  private crosses(order: Order, levelPrice: number) {
    if (order.type === 'market') return true;
    return order.side === 'buy' ? levelPrice <= order.price : levelPrice >= order.price;
  }

  private match(taker: Order, time: number): Trade[] {
    const book = taker.side === 'buy' ? this.asks : this.bids;
    const trades: Trade[] = [];
    while (taker.remaining > 0) {
      const lvl = book.best();
      if (!lvl || !this.crosses(taker, lvl.price)) break;
      while (taker.remaining > 0 && lvl.orders.length) {
        const maker = lvl.orders[0];
        const q = Math.min(taker.remaining, maker.remaining);
        taker.remaining -= q;
        taker.filled += q;
        maker.remaining -= q;
        maker.filled += q;
        lvl.total -= q;
        trades.push({
          id: this.nextTradeId++,
          time,
          price: lvl.price,
          qty: q,
          aggressor: taker.side,
          makerOrderId: maker.id,
          takerOrderId: taker.id,
          makerOwner: maker.owner,
          takerOwner: taker.owner,
        });
        if (maker.remaining === 0) {
          lvl.orders.shift();
          this.byId.delete(maker.id);
        }
      }
      if (lvl.orders.length === 0) book.removeLevel(lvl.price);
    }
    return trades;
  }

  private rest(order: Order) {
    const book = order.side === 'buy' ? this.bids : this.asks;
    const lvl = book.getOrCreate(order.price);
    order.seq = ++this.seq;
    lvl.orders.push(order);
    lvl.total += order.remaining;
    this.byId.set(order.id, order);
  }

  /** Cancels a resting order. Returns the cancelled order, or undefined if it is no longer resting. */
  cancel(id: number): Order | undefined {
    const order = this.byId.get(id);
    if (!order) return undefined;
    const book = order.side === 'buy' ? this.bids : this.asks;
    const lvl = book.levels.get(order.price);
    if (lvl) {
      const i = lvl.orders.indexOf(order);
      if (i >= 0) lvl.orders.splice(i, 1);
      lvl.total -= order.remaining;
      if (lvl.orders.length === 0) book.removeLevel(order.price);
    }
    this.byId.delete(id);
    return order;
  }

  /** Cancels every resting order owned by `owner`. Returns how many were cancelled. */
  cancelAll(owner: string): Order[] {
    const out: Order[] = [];
    for (const o of [...this.byId.values()]) if (o.owner === owner) {
      const c = this.cancel(o.id);
      if (c) out.push(c);
    }
    return out;
  }

  get(id: number): Order | undefined {
    return this.byId.get(id);
  }

  ordersOf(owner: string): Order[] {
    const out: Order[] = [];
    for (const o of this.byId.values()) if (o.owner === owner) out.push(o);
    return out;
  }

  bestBid(): number | undefined {
    return this.bids.prices[0];
  }
  bestAsk(): number | undefined {
    return this.asks.prices[0];
  }

  /** Size resting at a price on either side (0 if empty). */
  sizeAt(price: number): { bid: number; ask: number } {
    return { bid: this.bids.levels.get(price)?.total ?? 0, ask: this.asks.levels.get(price)?.total ?? 0 };
  }

  /** Quantity queued ahead of an order at its price level. */
  queueAhead(id: number): number {
    const o = this.byId.get(id);
    if (!o) return 0;
    const lvl = (o.side === 'buy' ? this.bids : this.asks).levels.get(o.price);
    if (!lvl) return 0;
    let ahead = 0;
    for (const x of lvl.orders) {
      if (x === o) break;
      ahead += x.remaining;
    }
    return ahead;
  }

  depth(side: Side, n: number): LevelView[] {
    const book = side === 'buy' ? this.bids : this.asks;
    return book.prices.slice(0, n).map((p) => {
      const l = book.levels.get(p)!;
      return { price: p, qty: l.total, orders: l.orders.length };
    });
  }

  totals() {
    return { bid: this.bids.totalQty(), ask: this.asks.totalQty() };
  }

  /** Every resting order, in no particular order. */
  allResting(): Order[] {
    return [...this.byId.values()];
  }
}
