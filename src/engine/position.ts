import type { Side } from './types';

/**
 * Average-cost position tracking. Prices are in ticks; P&L is returned in ticks × lots
 * so the caller decides the money value of one tick.
 */
export class Position {
  /** Signed lots: positive = long, negative = short. */
  qty = 0;
  /** Average entry price in ticks (fractional). 0 when flat. */
  avg = 0;
  /** Realized P&L in tick·lots. */
  realized = 0;
  /** Total lots traded (both sides). */
  volume = 0;

  apply(side: Side, price: number, lots: number) {
    const signed = side === 'buy' ? lots : -lots;
    this.volume += lots;
    if (this.qty === 0 || Math.sign(this.qty) === Math.sign(signed)) {
      // opening or adding: blend the average
      const newQty = this.qty + signed;
      this.avg = (this.avg * Math.abs(this.qty) + price * lots) / Math.abs(newQty);
      this.qty = newQty;
      return;
    }
    // reducing, closing or flipping
    const closing = Math.min(lots, Math.abs(this.qty));
    const dir = Math.sign(this.qty); // +1 long, -1 short
    this.realized += (price - this.avg) * closing * dir;
    const newQty = this.qty + signed;
    if (newQty === 0) {
      this.qty = 0;
      this.avg = 0;
    } else if (Math.sign(newQty) === dir) {
      this.qty = newQty; // partial close keeps the average
    } else {
      this.qty = newQty; // flipped: the remainder opens at this price
      this.avg = price;
    }
  }

  /** Unrealized P&L in tick·lots, marked at `mark`. */
  open(mark: number): number {
    if (this.qty === 0) return 0;
    return (mark - this.avg) * this.qty;
  }
}
