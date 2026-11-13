// Best score per scenario, kept in this browser only.
const key = (id: string) => `order-book-sim.best.${id}`;

export function loadBest(id: string): number | undefined {
  try {
    const v = localStorage.getItem(key(id));
    return v === null ? undefined : Number(v);
  } catch {
    return undefined;
  }
}

export function saveBest(id: string, score: number): boolean {
  const prev = loadBest(id);
  if (prev !== undefined && prev >= score) return false;
  try {
    localStorage.setItem(key(id), String(score));
  } catch {
    /* storage unavailable: ignore */
  }
  return true;
}
