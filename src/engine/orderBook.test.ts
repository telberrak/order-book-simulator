import { describe, expect, it } from 'vitest';
import { OrderBook } from './orderBook';
import { Position } from './position';
import { CandleBuilder } from './candles';

const lim = (owner: string, side: 'buy' | 'sell', price: number, qty: number, tif: 'GTC' | 'IOC' = 'GTC') =>
  ({ owner, side, type: 'limit' as const, price, qty, tif });
const mkt = (owner: string, side: 'buy' | 'sell', qty: number) => ({ owner, side, type: 'market' as const, qty });

describe('OrderBook', () => {
  it('rests non-crossing limit orders and sorts levels best-first', () => {
    const b = new OrderBook();
    b.submit(lim('a', 'buy', 100, 5));
    b.submit(lim('a', 'buy', 102, 1));
    b.submit(lim('a', 'buy', 101, 2));
    b.submit(lim('a', 'sell', 105, 3));
    b.submit(lim('a', 'sell', 104, 4));
    expect(b.bids.prices).toEqual([102, 101, 100]);
    expect(b.asks.prices).toEqual([104, 105]);
    expect(b.bestBid()).toBe(102);
    expect(b.bestAsk()).toBe(104);
    expect(b.totals()).toEqual({ bid: 8, ask: 7 });
  });

  it('fills in price-time priority and prints at the maker price', () => {
    const b = new OrderBook();
    const first = b.submit(lim('m1', 'sell', 101, 2)).order;
    const second = b.submit(lim('m2', 'sell', 101, 3)).order;
    b.submit(lim('m3', 'sell', 100, 1));
    const r = b.submit(lim('t', 'buy', 102, 4));
    expect(r.status).toBe('filled');
    expect(r.trades.map((t) => [t.makerOwner, t.price, t.qty])).toEqual([
      ['m3', 100, 1],
      ['m1', 101, 2],
      ['m2', 101, 1],
    ]);
    expect(r.trades.every((t) => t.aggressor === 'buy')).toBe(true);
    expect(b.get(first.id)).toBeUndefined();
    expect(b.get(second.id)?.remaining).toBe(2);
    expect(b.sizeAt(101).ask).toBe(2);
  });

  it('partially fills a limit order and rests the remainder', () => {
    const b = new OrderBook();
    b.submit(lim('m', 'sell', 100, 2));
    const r = b.submit(lim('t', 'buy', 100, 5));
    expect(r.status).toBe('partial-resting');
    expect(r.order.filled).toBe(2);
    expect(r.order.remaining).toBe(3);
    expect(b.bestBid()).toBe(100);
    expect(b.bestAsk()).toBeUndefined();
    expect(b.sizeAt(100).bid).toBe(3);
  });

  it('does not trade through the limit price', () => {
    const b = new OrderBook();
    b.submit(lim('m', 'sell', 100, 1));
    b.submit(lim('m', 'sell', 103, 5));
    const r = b.submit(lim('t', 'buy', 101, 4));
    expect(r.trades).toHaveLength(1);
    expect(b.bestBid()).toBe(101);
    expect(b.bestAsk()).toBe(103);
  });

  it('market orders sweep levels and cancel any leftover', () => {
    const b = new OrderBook();
    b.submit(lim('m', 'buy', 99, 2));
    b.submit(lim('m', 'buy', 98, 2));
    const r = b.submit(mkt('t', 'sell', 6));
    expect(r.trades.map((t) => [t.price, t.qty])).toEqual([
      [99, 2],
      [98, 2],
    ]);
    expect(r.status).toBe('cancelled');
    expect(r.unfilledCancelled).toBe(2);
    expect(b.bestBid()).toBeUndefined();
    expect(b.bestAsk()).toBeUndefined();
  });

  it('IOC limit orders never rest', () => {
    const b = new OrderBook();
    b.submit(lim('m', 'sell', 100, 1));
    const r = b.submit(lim('t', 'buy', 100, 3, 'IOC'));
    expect(r.order.filled).toBe(1);
    expect(r.unfilledCancelled).toBe(2);
    expect(b.bestBid()).toBeUndefined();
  });

  it('cancel removes the order and keeps queue order for the rest', () => {
    const b = new OrderBook();
    const a = b.submit(lim('a', 'buy', 100, 1)).order;
    const c = b.submit(lim('c', 'buy', 100, 2)).order;
    const d = b.submit(lim('d', 'buy', 100, 3)).order;
    expect(b.queueAhead(d.id)).toBe(3);
    expect(b.cancel(c.id)?.id).toBe(c.id);
    expect(b.cancel(c.id)).toBeUndefined();
    expect(b.queueAhead(d.id)).toBe(1);
    const r = b.submit(mkt('t', 'sell', 2));
    expect(r.trades.map((t) => t.makerOrderId)).toEqual([a.id, d.id]);
    b.cancel(d.id);
    expect(b.bids.prices).toEqual([]);
  });

  it('cancelAll only touches the owner', () => {
    const b = new OrderBook();
    b.submit(lim('me', 'buy', 100, 1));
    b.submit(lim('me', 'sell', 110, 1));
    b.submit(lim('bot', 'buy', 100, 1));
    expect(b.cancelAll('me')).toHaveLength(2);
    expect(b.ordersOf('me')).toHaveLength(0);
    expect(b.sizeAt(100).bid).toBe(1);
  });

  it('rejects bad input', () => {
    const b = new OrderBook();
    expect(b.submit(lim('a', 'buy', 100, 0)).status).toBe('rejected');
    expect(b.submit({ owner: 'a', side: 'buy', type: 'limit', qty: 1 }).status).toBe('rejected');
  });
});

describe('Position', () => {
  it('averages in, partially closes, flips', () => {
    const p = new Position();
    p.apply('buy', 100, 2);
    p.apply('buy', 104, 2);
    expect(p.qty).toBe(4);
    expect(p.avg).toBe(102);
    p.apply('sell', 106, 1);
    expect(p.realized).toBe(4);
    expect(p.qty).toBe(3);
    expect(p.avg).toBe(102);
    expect(p.open(100)).toBe(-6);
    p.apply('sell', 101, 5); // close 3 at -1 each, open short 2 @101
    expect(p.realized).toBe(1);
    expect(p.qty).toBe(-2);
    expect(p.avg).toBe(101);
    expect(p.open(99)).toBe(4);
    p.apply('buy', 99, 2);
    expect(p.qty).toBe(0);
    expect(p.realized).toBe(5);
    expect(p.volume).toBe(12);
  });
});

describe('CandleBuilder', () => {
  it('buckets trades per timeframe', () => {
    const c = new CandleBuilder([5, 60]);
    c.add(0, 10, 1, true);
    c.add(3, 12, 2, false);
    c.add(4.9, 9, 1, true);
    c.add(5, 11, 4, true);
    c.add(61, 13, 1, false);
    expect(c.get(5)).toEqual([
      { time: 0, open: 10, high: 12, low: 9, close: 9, volume: 4, buyVolume: 2 },
      { time: 5, open: 11, high: 11, low: 11, close: 11, volume: 4, buyVolume: 4 },
      { time: 60, open: 13, high: 13, low: 13, close: 13, volume: 1, buyVolume: 0 },
    ]);
    expect(c.get(60).map((x) => [x.time, x.open, x.close, x.volume])).toEqual([
      [0, 10, 11, 8],
      [60, 13, 13, 1],
    ]);
  });
});
