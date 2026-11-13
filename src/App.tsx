import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { scenarioById } from './sim/scenarios';
import { Simulation } from './sim/simulation';
import { GameBar } from './ui/GameBar';
import { Ladder } from './ui/Ladder';
import { Ticket } from './ui/Ticket';
import { Tape } from './ui/Tape';
import { Chart } from './ui/Chart';
import { Blotter } from './ui/Blotter';
import { RoundOver, Toasts } from './ui/Overlays';
import { loadBest, saveBest } from './ui/scores';
import type { TicketState } from './ui/ticketState';

const TICK_MS = 100;

export function App() {
  const [sim, setSim] = useState(() => new Simulation(scenarioById('fed')));
  const version = useSyncExternalStore(sim.subscribe, sim.getVersion);
  const [ticket, setTicket] = useState<TicketState>(() => ({ side: 'buy', kind: 'limit', price: sim.book.bestBid() ?? sim.last, qty: 1, tif: 'GTC' }));
  const [best, setBest] = useState(() => loadBest(sim.scenario.id));
  const [newBest, setNewBest] = useState(false);
  const [showResult, setShowResult] = useState(false);
  const ticketRef = useRef(ticket);
  ticketRef.current = ticket;

  const patchTicket = useCallback((p: Partial<TicketState>) => setTicket((t) => ({ ...t, ...p })), []);

  // start each round with the ticket on the best bid
  useEffect(() => {
    setTicket((t) => ({ ...t, price: sim.book.bestBid() ?? sim.last }));
  }, [sim]);

  // drive the simulation clock
  useEffect(() => {
    let last = performance.now();
    const h = window.setInterval(() => {
      const now = performance.now();
      sim.advance(now - last);
      last = now;
    }, TICK_MS);
    return () => window.clearInterval(h);
  }, [sim]);

  // round end: record the score once
  const recorded = useRef<Simulation>();
  useEffect(() => {
    if (sim.status === 'ended' && sim.result && recorded.current !== sim) {
      recorded.current = sim;
      const isNew = saveBest(sim.scenario.id, sim.result.score);
      setNewBest(isNew);
      setBest(loadBest(sim.scenario.id));
      setShowResult(true);
    }
  }, [sim, version]);

  const startRound = useCallback((id: string) => {
    const next = new Simulation(scenarioById(id));
    setSim((prev) => {
      next.setSpeed(prev.speed);
      return next;
    });
    setBest(loadBest(id));
    setShowResult(false);
    setNewBest(false);
  }, []);

  const send = useCallback(() => {
    const t = ticketRef.current;
    sim.submit({ side: t.side, kind: t.kind, price: t.kind === 'market' ? undefined : t.price, qty: t.qty, tif: t.tif });
  }, [sim]);

  const pick = useCallback(
    (price: number, sendNow: boolean) => {
      const t = ticketRef.current;
      const bb = sim.book.bestBid();
      const ba = sim.book.bestAsk();
      let side = t.side;
      let kind = t.kind === 'market' ? 'limit' : t.kind;
      if (kind === 'stop') side = price > sim.last ? 'buy' : 'sell';
      else if (ba !== undefined && price >= ba) side = 'sell';
      else if (bb !== undefined && price <= bb) side = 'buy';
      const next = { ...t, price, side, kind };
      setTicket(next);
      if (sendNow) sim.submit({ side, kind, price, qty: next.qty, tif: next.tif });
    },
    [sim],
  );

  // hotkeys
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA' || e.ctrlKey || e.metaKey || e.altKey) return;
      const k = e.key.toLowerCase();
      if (k === 'b') patchTicket({ side: 'buy' });
      else if (k === 's') patchTicket({ side: 'sell' });
      else if (k === 'p') sim.togglePause();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [sim, patchTicket]);

  return (
    <>
      <GameBar sim={sim} best={best} onScenario={startRound} onNewRound={() => startRound(sim.scenario.id)} />
      <main className="grid">
        <Ladder sim={sim} ticketPrice={ticket.kind === 'market' ? NaN : ticket.price} onPick={pick} />
        <Chart sim={sim} version={version} />
        <Ticket sim={sim} t={ticket} set={patchTicket} onSend={send} />
        <Tape sim={sim} />
        <Blotter sim={sim} />
      </main>
      <div className="help">
        <span>{sim.scenario.blurb}</span>
        <span>
          <kbd>B</kbd> / <kbd>S</kbd> switch side
        </span>
        <span>
          <kbd>P</kbd> pause
        </span>
        <span>
          <kbd>Shift</kbd>+click a price to send instantly
        </span>
        <span>Simulated market. Commission $2 per lot.</span>
      </div>
      <Toasts sim={sim} />
      {showResult && sim.result && (
        <RoundOver sim={sim} best={best} newBest={newBest} onAgain={() => startRound(sim.scenario.id)} onClose={() => setShowResult(false)} />
      )}
    </>
  );
}
