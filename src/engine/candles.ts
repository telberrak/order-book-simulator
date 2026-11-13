export interface Candle {
  /** Bucket start, in seconds. */
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  /** Volume where the aggressor was a buyer. */
  buyVolume: number;
}

/**
 * Builds OHLCV candles for several timeframes at once from a stream of trades.
 * Bars with no trades are left out (the chart simply shows a gap in time).
 */
export class CandleBuilder {
  private readonly series = new Map<number, Candle[]>();
  constructor(readonly timeframes: number[], private readonly maxBars = 2000) {
    for (const tf of timeframes) this.series.set(tf, []);
  }

  /** @param timeSec trade time in seconds; @param price in display units */
  add(timeSec: number, price: number, qty: number, buyAggressor: boolean) {
    for (const tf of this.timeframes) {
      const arr = this.series.get(tf)!;
      const bucket = Math.floor(timeSec / tf) * tf;
      const last = arr[arr.length - 1];
      if (last && last.time === bucket) {
        last.high = Math.max(last.high, price);
        last.low = Math.min(last.low, price);
        last.close = price;
        last.volume += qty;
        if (buyAggressor) last.buyVolume += qty;
      } else {
        arr.push({ time: bucket, open: price, high: price, low: price, close: price, volume: qty, buyVolume: buyAggressor ? qty : 0 });
        if (arr.length > this.maxBars) arr.splice(0, arr.length - this.maxBars);
      }
    }
  }

  get(tf: number): Candle[] {
    return this.series.get(tf) ?? [];
  }

  clear() {
    for (const tf of this.timeframes) this.series.set(tf, []);
  }
}
