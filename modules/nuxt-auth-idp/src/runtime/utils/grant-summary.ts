/**
 * The requester's own account of what it is asking for (#1310) — the thing
 * that turns "curl -X POST .../merge" into a decision an owner can make from
 * a phone. Self-reported by design: the card labels it as such, the command
 * stays the ground truth, and the link is the way to check.
 */

export interface GrantSummary {
  text: string
  link?: string
}

/**
 * Links arrive from the requester, so they are a trust boundary: an
 * `<a href>` accepts `javascript:` and `data:` just as happily as https.
 * Anything that is not plain http(s) is not linked at all.
 */
export function safeSummaryLink(link: string | undefined): string | null {
  if (!link) return null
  try {
    const url = new URL(link)
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : null
  }
  catch {
    return null
  }
}

/** Nothing to render for an empty or whitespace-only summary. */
export function grantSummaryText(summary: GrantSummary | undefined): string | null {
  return summary?.text?.trim() || null
}
