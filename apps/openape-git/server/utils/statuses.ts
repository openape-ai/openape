export type StatusState = 'pending' | 'success' | 'failure'

// A commit can carry several contexts (lint, tests, …). The badge shows the
// worst one — a red check is the news, a green one only means nothing is red.
const RANK: Record<StatusState, number> = { success: 0, pending: 1, failure: 2 }

export interface StatusRow {
  sha: string
  state: string
  targetUrl?: string | null
}

export interface StatusSummary {
  state: StatusState
  targetUrl: string | null
}

/** Worst state per sha, with the link of the status that decided it. */
export function summarizeStatuses(rows: StatusRow[]): Map<string, StatusSummary> {
  const summary = new Map<string, StatusSummary>()
  for (const row of rows) {
    if (!(row.state in RANK)) continue
    const state = row.state as StatusState
    const current = summary.get(row.sha)
    if (current && RANK[current.state] >= RANK[state]) continue
    summary.set(row.sha, { state, targetUrl: row.targetUrl ?? null })
  }
  return summary
}
