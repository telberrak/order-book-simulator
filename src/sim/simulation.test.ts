import { describe, expect, it } from 'vitest';
import { SCENARIOS, scenarioById } from './scenarios';
import { PLAYER, Simulation, TICK_VALUE, toTicks } from './simulation';

describe('Simulation', () => {
  for (const sc of SCENARIOS) {
    it(`${sc.name}: warms up a sane, uncrossed market and runs a full round`, () => {
      const sim = new Simulation(sc, 12345);
      expect(sim.tape.length).toBeGreaterThan(200);
      expect(sim.candles.get(15).length).toBeGreaterThan(20);
      let checks = 0;
      while (sim.status === 'running') {
        sim.advance(1000);
        const b = sim.book.bestBid();
        const a = sim.book.bestAsk();
        if (b !== undefined && a !== undefined) expect(b).toBeLessThan(a);
        checks++;
      }
      expect(checks).toBeGreaterThan(sc.challenge.durationSec - 2);
      expect(sim.result).toBeDefined();
      // price stays in a plausible range (no runaway)
      expect(Math.abs(sim.last - toTicks(4800))).toBeLessThan(800);
      // book still has two sides
      expect(sim.book.depth('buy', 5).length).toBeGreaterThan(0);
      expect(sim.book.depth('sell', 5).length).toBeGreaterThan(0);
    });
  }

  it('fills a marketable player order and tracks P&L and commission', () => {
    const sim = new Simulation(scenarioById('quiet'), 7);
    const ask = sim.book.bestAsk()!;
    const r = sim.submit({ side: 'buy', kind: 'market', qty: 2 });
    expect(r.ok).toBe(true);
    expect(sim.player.qty).toBe(2);
    expect(sim.fills[0].liquidity).toBe('Taker');
    expect(sim.fills.reduce((s, f) => s + f.qty, 0)).toBe(2);
    expect(sim.commissions).toBe(4);
    expect(sim.player.avg).toBeGreaterThanOrEqual(ask);
    sim.flatten();
    expect(sim.player.qty).toBe(0);
    expect(sim.netPnl()).toBeCloseTo(sim.player.realized * TICK_VALUE - 8);
  });

  it('rests a passive limit order, shows it on the ladder and cancels it', () => {
    const sim = new Simulation(scenarioById('quiet'), 9);
    const px = sim.book.bestBid()! - 3;
    sim.submit({ side: 'buy', kind: 'limit', price: px, qty: 3 });
    const mine = sim.book.ordersOf(PLAYER);
    expect(mine).toHaveLength(1);
    expect(sim.playerOrders()[0].queue).toBeGreaterThan(0);
    const row = sim.ladder(12).find((r) => r.price === px);
    expect(row?.myBid ?? 0).toBe(3);
    sim.cancel(mine[0].id);
    expect(sim.book.ordersOf(PLAYER)).toHaveLength(0);
  });

  it('enforces the lot limit on exposure-increasing orders only', () => {
    const sim = new Simulation(scenarioById('quiet'), 3); // max 5 lots
    expect(sim.submit({ side: 'buy', kind: 'market', qty: 6 }).ok).toBe(false);
    expect(sim.submit({ side: 'buy', kind: 'market', qty: 5 }).ok).toBe(true);
    expect(sim.submit({ side: 'buy', kind: 'limit', price: sim.book.bestBid()! - 5, qty: 1 }).ok).toBe(false);
    expect(sim.submit({ side: 'sell', kind: 'market', qty: 5 }).ok).toBe(true);
    expect(sim.player.qty).toBe(0);
  });

  it('arms stops on the correct side and triggers them', () => {
    const sim = new Simulation(scenarioById('trend'), 21);
    expect(sim.submit({ side: 'buy', kind: 'stop', price: sim.last - 1, qty: 1 }).ok).toBe(false);
    sim.submit({ side: 'buy', kind: 'stop', price: sim.last + 2, qty: 1 });
    sim.submit({ side: 'sell', kind: 'stop', price: sim.last - 2, qty: 1 });
    expect(sim.stops).toHaveLength(2);
    for (let i = 0; i < 600 && sim.stops.length === 2; i++) sim.advance(1000);
    expect(sim.stops.length).toBeLessThan(2);
    expect(sim.fills.length).toBeGreaterThan(0);
  });
});
