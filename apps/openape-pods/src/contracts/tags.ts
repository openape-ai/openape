/** Free owner tags of Pods and networks (issue 1459). */
export const tagLimits = { perItem: 8, length: 32 } as const
const tagPattern = /^[\p{L}\p{N}][\p{L}\p{N}-]*$/u

/** One tag as stored: trimmed, lowercase, inner spaces as hyphens; letters, digits and hyphens only. */
export function normalizeTag(value: unknown): string {
  const tag = typeof value === 'string' ? value.trim().toLocaleLowerCase('de').replace(/\s+/g, '-') : ''
  if (!tag || tag.length > tagLimits.length || !tagPattern.test(tag)) throw new Error('Invalid tag')
  return tag
}

/** A tag list as stored: normalized, without repeats, in the given order. */
export function normalizeTags(value: unknown): string[] {
  if (!Array.isArray(value)) throw new Error('Invalid tags')
  const tags = [...new Set(value.map(normalizeTag))]
  if (tags.length > tagLimits.perItem) throw new Error('Too many tags')
  return tags
}
