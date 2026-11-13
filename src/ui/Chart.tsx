import { useEffect, useRef, useState } from 'react';
import {
  ColorType,
  CrosshairMode,
  LineStyle,
  createChart,
  type IChartApi,
  type IPriceLine,
  type ISeriesApi,
  type UTCTimestamp,
} from 'lightweight-charts';
import type { Candle } from '../engine/candles';
import { PLAYER, TIMEFRAMES, toPrice, toTicks, type Simulation } from '../sim/simulation';
import { fmtPrice } from './format';

const TF_LABEL: Record<number, string> = { 5: '5s', 15: '15s', 60: '1m', 300: '5m' };

function cssVar(name: string) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

export function Chart({ sim, version }: { sim: Simulation; version: number }) {
  const [tf, setTf] = useState<number>(15);
  const boxRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi>();
  const candleRef = useRef<ISeriesApi<'Candlestick'>>();
  const volRef = useRef<ISeriesApi<'Histogram'>>();
  const lastTimeRef = useRef(0);
  const linesRef = useRef<{ key: string; lines: IPriceLine[] }>({ key: '', lines: [] });

  // create the chart once
  useEffect(() => {
    const el = boxRef.current!;
    const bid = cssVar('--bid');
    const ask = cssVar('--ask');
    const chart = createChart(el, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: cssVar('--panel') },
        textColor: cssVar('--muted'),
        fontFamily: 'JetBrains Mono, ui-monospace, monospace',
        fontSize: 10,
      },
      grid: { vertLines: { color: cssVar('--line') }, horzLines: { color: cssVar('--line') } },
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: { borderColor: cssVar('--line-2') },
      timeScale: { borderColor: cssVar('--line-2'), timeVisible: true, secondsVisible: true, rightOffset: 4, barSpacing: 8 },
    });
    const candles = chart.addCandlestickSeries({
      upColor: bid,
      downColor: ask,
      borderUpColor: bid,
      borderDownColor: ask,
      wickUpColor: bid,
      wickDownColor: ask,
      priceFormat: { type: 'price', precision: 2, minMove: 0.25 },
    });
    const vol = chart.addHistogramSeries({ priceScaleId: 'vol', priceFormat: { type: 'volume' }, lastValueVisible: false, priceLineVisible: false });
    chart.priceScale('vol').applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });
    candles.priceScale().applyOptions({ scaleMargins: { top: 0.08, bottom: 0.24 } });
    chartRef.current = chart;
    candleRef.current = candles;
    volRef.current = vol;
    return () => {
      chart.remove();
      chartRef.current = undefined;
      linesRef.current = { key: '', lines: [] };
    };
  }, []);

  const toBar = (c: Candle) => ({ time: c.time as UTCTimestamp, open: c.open, high: c.high, low: c.low, close: c.close });
  const toVol = (c: Candle) => ({
    time: c.time as UTCTimestamp,
    value: c.volume,
    color: c.close >= c.open ? 'rgba(47,191,143,.38)' : 'rgba(240,89,107,.38)',
  });

  // full reload on new game or timeframe change
  useEffect(() => {
    const data = sim.candles.get(tf);
    candleRef.current?.setData(data.map(toBar));
    volRef.current?.setData(data.map(toVol));
    lastTimeRef.current = data.length ? data[data.length - 1].time : 0;
    // show roughly the last 100 bars, with a little room on the right
    if (data.length) chartRef.current?.timeScale().setVisibleLogicalRange({ from: Math.max(0, data.length - 100), to: data.length + 3 });
  }, [sim, tf]);

  // incremental updates
  useEffect(() => {
    const data = sim.candles.get(tf);
    let i = data.length - 1;
    while (i > 0 && data[i].time > lastTimeRef.current) i--;
    for (; i < data.length; i++) {
      if (data[i].time < lastTimeRef.current) continue;
      candleRef.current?.update(toBar(data[i]));
      volRef.current?.update(toVol(data[i]));
      lastTimeRef.current = data[i].time;
    }

    // price lines for the player's average price and working orders
    const series = candleRef.current;
    if (!series) return;
    const mine = sim.book.ordersOf(PLAYER).map((o) => ({ p: o.price, t: `${o.side === 'buy' ? 'B' : 'S'}${o.remaining}` }));
    const stops = sim.stops.map((s) => ({ p: s.stop, t: `STP ${s.side === 'buy' ? 'B' : 'S'}${s.qty}` }));
    const avg = sim.player.qty !== 0 ? sim.player.avg : undefined;
    const key = JSON.stringify([mine, stops, avg]);
    if (key === linesRef.current.key) return;
    for (const l of linesRef.current.lines) series.removePriceLine(l);
    const color = cssVar('--mine');
    const lines: IPriceLine[] = [];
    for (const m of [...mine, ...stops])
      lines.push(series.createPriceLine({ price: toPrice(m.p), color, lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: m.t }));
    if (avg !== undefined)
      lines.push(series.createPriceLine({ price: toPrice(avg), color, lineWidth: 2, lineStyle: LineStyle.Solid, axisLabelVisible: true, title: 'AVG' }));
    linesRef.current = { key, lines };
  }, [sim, tf, version]);

  const bars = sim.candles.get(tf);
  const l = bars[bars.length - 1];
  return (
    <section className="p chart" aria-label="Price chart">
      <div className="p-h">
        <h2>Chart</h2>
        <div className="seg" role="group" aria-label="Timeframe">
          {TIMEFRAMES.map((x) => (
            <button key={x} aria-pressed={tf === x} onClick={() => setTf(x)}>
              {TF_LABEL[x]}
            </button>
          ))}
        </div>
        {l && (
          <div className="aside ohlc">
            <span>
              O <span className="num">{fmtPrice(toTicks(l.open))}</span>
            </span>
            <span>
              H <span className="num">{fmtPrice(toTicks(l.high))}</span>
            </span>
            <span>
              L <span className="num">{fmtPrice(toTicks(l.low))}</span>
            </span>
            <span>
              C <span className="num">{fmtPrice(toTicks(l.close))}</span>
            </span>
            <span>
              V <span className="num">{l.volume}</span>
            </span>
          </div>
        )}
      </div>
      <div className="chart-wrap">
        <div className="lw" ref={boxRef} />
      </div>
      <div className="legend">
        <span>
          <i className="solid" />
          Your average price
        </span>
        <span>
          <i />
          Your working orders and stops
        </span>
      </div>
    </section>
  );
}
