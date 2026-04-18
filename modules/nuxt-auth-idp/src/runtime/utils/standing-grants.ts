import type { OpenApeCliResourceRef, OpenApeGrant } from '@openape/core'
import type { StandingGrantRequest } from '@openape/grants'

/**
 * Small UI-facing helpers for standing grants. Server-side logic lives in
 * `@openape/grants/standing-grants.ts`; this module handles display
 * formatting and form-to-request conversion for the Phase 2 web UI.
 */

/**
 * Render a human-readable scope string for a standing grant.
 *
 * Examples:
 *   "git (repo: owner=patrick), risk≤high, always"
 *   "any CLI (wildcard), risk≤medium, timed 3600s"
 *   "echo (any resource), risk≤low, always"
 */
export function formatStandingGrantScope(sg: OpenApeGrant): string {
  if (!sg.request || (sg.request as unknown as { type?: string }).type !== 'standing') {
    return 'unknown'
  }
  const req = sg.request as unknown as StandingGrantRequest
  const cli = req.cli_id ? req.cli_id : 'any CLI'
  const resources = formatResourceChainTemplate(req.resource_chain_template)
  const risk = req.max_risk ? `risk≤${req.max_risk}` : 'any risk'
  const grantType = req.grant_type === 'timed' && req.duration
    ? `timed ${req.duration}s`
    : req.grant_type
  return `${cli} (${resources}), ${risk}, ${grantType}`
}

/**
 * Compact resource-chain preview:
 *   []                                       → "any resource"
 *   [{repo}]                                 → "repo (any)"
 *   [{repo, selector: {owner: 'patrick'}}]   → "repo: owner=patrick"
 *   multiple                                  → joined with " / "
 */
export function formatResourceChainTemplate(chain: OpenApeCliResourceRef[]): string {
  if (chain.length === 0) return 'any resource'
  return chain.map((ref) => {
    if (!ref.selector || Object.keys(ref.selector).length === 0) {
      return `${ref.resource} (any)`
    }
    const sel = Object.entries(ref.selector)
      .map(([k, v]) => `${k}=${v}`)
      .join(', ')
    return `${ref.resource}: ${sel}`
  }).join(' / ')
}

/**
 * Parse textarea input into a `OpenApeCliResourceRef[]`. Format is one
 * line per resource:
 *
 *   repo                               → { resource: 'repo' } (wildcard)
 *   repo:owner=patrick                 → { resource: 'repo', selector: { owner: 'patrick' } }
 *   repo:owner=patrick,name=app        → { resource: 'repo', selector: { owner: 'patrick', name: 'app' } }
 *
 * Blank input → [] (wildcard across CLI).
 * Throws on malformed lines so the UI surfaces a 400-ish error inline.
 */
export function parseResourceChainInput(text: string): OpenApeCliResourceRef[] {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean)
  return lines.map((line) => {
    const colonIdx = line.indexOf(':')
    if (colonIdx === -1) {
      return { resource: line }
    }
    const resource = line.slice(0, colonIdx).trim()
    const selectorSpec = line.slice(colonIdx + 1).trim()
    if (!resource) {
      throw new Error(`Missing resource in: "${line}"`)
    }
    if (!selectorSpec) {
      return { resource }
    }
    const selector: Record<string, string> = {}
    for (const seg of selectorSpec.split(',')) {
      const eq = seg.indexOf('=')
      if (eq === -1) throw new Error(`Selector segment needs "key=value": "${seg}"`)
      const key = seg.slice(0, eq).trim()
      const value = seg.slice(eq + 1).trim()
      if (!key || !value) throw new Error(`Empty key or value in: "${seg}"`)
      selector[key] = value
    }
    return { resource, selector }
  })
}

/**
 * Relative-time string for created_at / decided_at timestamps (seconds).
 * UI-only — loose precision OK.
 */
export function formatRelativeTime(seconds: number): string {
  if (!seconds) return '—'
  const diff = Math.floor(Date.now() / 1000) - seconds
  if (diff < 60) return 'just now'
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  if (diff < 86400 * 30) return `${Math.floor(diff / 86400)}d ago`
  return new Date(seconds * 1000).toLocaleDateString()
}
