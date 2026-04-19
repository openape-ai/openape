/**
 * Client-side mirror of `selectorValueMatches` from `@openape/grants`. Used by
 * the scoped-command wizard to live-preview which sample values a user-entered
 * glob pattern would match. Keep logic in sync with
 * `packages/grants/src/cli-permissions.ts:selectorValueMatches`.
 */

export function globToRegex(pattern: string): RegExp {
  const escaped = pattern
    .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
  return new RegExp(`^${escaped}$`)
}

export function selectorValueMatches(pattern: string, required: string): boolean {
  if (!pattern.includes('*')) return pattern === required
  if (pattern.length > 256) return false
  return globToRegex(pattern).test(required)
}

export interface PreviewMatch {
  sample: string
  matches: boolean
}

export function previewMatches(pattern: string, samples: string[]): PreviewMatch[] {
  if (!pattern) return samples.map(sample => ({ sample, matches: false }))
  return samples.map(sample => ({ sample, matches: selectorValueMatches(pattern, sample) }))
}
