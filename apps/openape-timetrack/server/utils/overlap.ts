// Pure interval-overlap detection — no DB/Nitro imports, unit-testable.
// Two entries of the same user overlap when their [startedAt, endedAt)
// intervals intersect: a.start < b.end AND b.start < a.end.

export interface Interval {
  id: string
  startedAt: number | null
  endedAt: number | null
}

/**
 * Returns the set of entry ids that overlap at least one OTHER entry.
 * Entries without both bounds are ignored (can't overlap-test them).
 * O(n²) — fine for one user's month of entries.
 */
export function computeOverlaps(entries: Interval[]): Set<string> {
  const overlapping = new Set<string>()
  const valid = entries.filter(e => typeof e.startedAt === 'number' && typeof e.endedAt === 'number')
  for (let i = 0; i < valid.length; i++) {
    for (let j = i + 1; j < valid.length; j++) {
      const a = valid[i]!
      const b = valid[j]!
      if (a.startedAt! < b.endedAt! && b.startedAt! < a.endedAt!) {
        overlapping.add(a.id)
        overlapping.add(b.id)
      }
    }
  }
  return overlapping
}
