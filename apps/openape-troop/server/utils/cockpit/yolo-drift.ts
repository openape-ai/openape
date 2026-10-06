// Drift zwischen den aktuellen Rollen-tools einer Org und der Toolliste, die
// flowed into the policy on the last successful YOLO sync. What is compared are
// the sync's INPUTS (the role union), not the derived patterns —
// die Ableitung (Plumbing, OUTWARD-Filter, Formen-Expansion) bleibt allein im
// worker and does not need rebuilding here.
export function diffTools(current: string[], synced: string[]): { added: string[], removed: string[] } {
  const cur = new Set(current)
  const syn = new Set(synced)
  return {
    added: [...cur].filter(t => !syn.has(t)),
    removed: [...syn].filter(t => !cur.has(t)),
  }
}
