// Drift zwischen den aktuellen Rollen-tools einer Org und der Toolliste, die
// beim letzten erfolgreichen YOLO-Sync in die Policy geflossen ist. Verglichen
// werden die INPUTS des Syncs (Rollen-Union), nicht die abgeleiteten Patterns —
// die Ableitung (Plumbing, OUTWARD-Filter, Formen-Expansion) bleibt allein im
// Worker und muss hier nicht nachgebaut werden.
export function diffTools(current: string[], synced: string[]): { added: string[], removed: string[] } {
  const cur = new Set(current)
  const syn = new Set(synced)
  return {
    added: [...cur].filter(t => !syn.has(t)),
    removed: [...syn].filter(t => !cur.has(t)),
  }
}
