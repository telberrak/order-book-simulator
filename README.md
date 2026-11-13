# Order Book Simulator (TapeRunner)

A browser-only trading game built around a real limit order book. You trade a fictional
index future (`NVX·DEC`, tick 0.25, $50 a point) against a crowd of bots and try to hit
a P&L target inside a lot limit before the clock runs out.

## Run it

```bash
npm install
npm run dev      # http://localhost:5173
npm test         # engine + simulation tests (vitest)
npm run build    # static build in dist/, works from any path (GitHub Pages etc.)
```

No server is needed. Everything runs in the browser.

## How to play

- **Ladder.** Click a price to load it into the ticket (above the market becomes a sell,
  at or below becomes a buy). **Shift-click** sends it at once. Your working orders show as
  amber sizes; click one to cancel it.
- **Ticket.** Buy/sell, limit, market or stop, GTC or IOC. It shows queue ahead and the
  worst-case lot exposure before you send.
- **Tape and chart.** Every trade prints to Time & Sales (green = buyer lifted the offer,
  red = seller hit the bid) and builds candles for 5s / 15s / 1m / 5m.
- **Blotter.** Position, average price, open and realized P&L, fees ($2 per lot), open
  orders with cancel, and fills.
- **Game bar.** Pause (`P`), speed 1×–10×, scenario, new round, target progress, score and
  time left. Score is net P&L in dollars plus 1,000 if you reach the target. Best scores
  are saved in this browser.
- Hotkeys: `B` / `S` switch side, `P` pause.

### Scenarios

| Scenario | What happens | Challenge |
| --- | --- | --- |
| Quiet open | Deep book, gentle flow | $500, max 5 lots, 8 min |
| Fed minutes spike | Calm until 2:30, then a big repricing and higher volatility | $2,500, max 10 lots, 10 min |
| Liquidity crunch | Thin book, wide spreads, jumpy | $1,000, max 5 lots, 8 min |
| Spoofer in the book | A huge order appears near the touch and vanishes when price gets close | $2,000, max 8 lots, 9 min |
| Trend day | Steady one-way pressure | $3,000, max 10 lots, 10 min |

## How it works

```
src/
  engine/       pure, framework-free
    orderBook.ts  price-time priority matching: limit / market / IOC / cancel, partial fills
    position.ts   average-cost position and realized / open P&L
    candles.ts    OHLCV bars for several timeframes from the trade stream
  sim/
    simulation.ts the game loop: clock, bots, player orders, stops, risk limit, scoring
    scenarios.ts  scenario and challenge settings
    random.ts     seeded RNG
  ui/           React panels (ladder, ticket, tape, chart, blotter, game bar, overlays)
```

- Prices inside the engine are integer ticks, so there is no floating-point drift.
- Trades print at the resting order's price; the incoming order is the aggressor.
- Bots follow a hidden fair value (random walk with drift, jumps and scheduled shocks):
  market makers quote a ladder around it and keep queue priority on levels they don't
  move, informed and noise takers send market orders, background traders post short-lived
  limit orders, and the spoofer flashes large orders.
- The sim runs in 100 ms steps; speed multiplies sim time. Each round starts after a
  10-minute warm-up so the book, tape and chart already have history.
- The chart uses [Lightweight Charts](https://github.com/tradingview/lightweight-charts) (Apache-2.0).

## Not built yet

- Bracket (OCO) orders
- Saving and replaying a round from its seed
- Sound and more scenarios
