import type { OpenApeGrantSummary } from '@openape/core'

/**
 * The requester's own account of what it is asking for (#1310, fields since
 * #1473) — the thing that turns "curl -X POST .../merge" into a decision an
 * owner can make from a phone. Self-reported by design: the card labels every
 * field as the requester's statement, the command stays the ground truth, and
 * the link is the way to check.
 */
export interface GrantSummaryView {
  title: string
  description: string | null
  origin: string | null
  link: string | null
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

/** Nothing to render without a title; empty optional fields render as absent. */
export function grantSummaryView(summary: OpenApeGrantSummary | undefined): GrantSummaryView | null {
  const title = summary?.title?.trim()
  if (!summary || !title) return null
  return {
    title,
    description: summary.description?.trim() || null,
    origin: summary.origin?.trim() || null,
    link: safeSummaryLink(summary.link),
  }
}
