import type { OpenApeGrantSummary } from '@openape/core'

/**
 * Control, format (bidi controls, zero-width characters) and line/paragraph
 * separator characters can make displayed text differ from what was sent
 * (grants.md §3.4).
 */
const HIDDEN_CHARACTER = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u
const HIDDEN_CHARACTERS = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu

const LIMITS = { title: 120, description: 2000, origin: 120, link: 2048 } as const
type SummaryField = keyof typeof LIMITS
const FIELDS = Object.keys(LIMITS) as SummaryField[]

/** A request summary that violates grants.md §3.4; callers answer it with 400. */
export class InvalidGrantSummaryError extends Error {}

function codePointLength(value: string): number {
  return [...value].length
}

function hasHiddenCharacter(value: string, multiline: boolean): boolean {
  return HIDDEN_CHARACTER.test(multiline ? value.replaceAll('\n', '') : value)
}

function readField(summary: Record<string, unknown>, field: SummaryField): string | undefined {
  const value = summary[field]
  if (value === undefined) return undefined
  if (typeof value !== 'string') throw new InvalidGrantSummaryError(`summary.${field} must be a string`)
  if (codePointLength(value) > LIMITS[field]) throw new InvalidGrantSummaryError(`summary.${field} must be at most ${LIMITS[field]} characters`)
  if (hasHiddenCharacter(value, field === 'description')) {
    const allowed = field === 'description' ? ' other than line feeds' : ''
    throw new InvalidGrantSummaryError(`summary.${field} must not contain control or format characters${allowed}`)
  }
  return value
}

/**
 * Validates `request.summary` (grants.md §3.4). Returns the normalized value
 * or throws with a message suitable for a 400 response.
 */
export function parseGrantSummary(value: unknown): OpenApeGrantSummary | undefined {
  if (value === undefined) return undefined
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new InvalidGrantSummaryError('summary must be an object')
  const summary = value as Record<string, unknown>
  if ('text' in summary) throw new InvalidGrantSummaryError('summary.text is no longer supported; send title and description')
  const unknown = Object.keys(summary).filter(key => !FIELDS.includes(key as SummaryField))
  if (unknown.length) throw new InvalidGrantSummaryError(`summary has unknown fields: ${unknown.join(', ')}`)
  const title = readField(summary, 'title')
  if (!title?.trim()) throw new InvalidGrantSummaryError('summary.title is required and must not be blank')
  const result: OpenApeGrantSummary = { title }
  for (const field of ['description', 'origin', 'link'] as const) {
    const text = readField(summary, field)
    if (text !== undefined) result[field] = text
  }
  return result
}

/** Cuts at a word boundary when one is reasonably close and marks the cut. */
function truncate(value: string, limit: number): string {
  const points = [...value]
  if (points.length <= limit) return value
  const cut = points.slice(0, limit - 1).join('')
  const space = cut.lastIndexOf(' ')
  return `${(space >= limit / 2 ? cut.slice(0, space) : cut).trimEnd()}…`
}

function withoutBlankEdges(lines: string[]): string[] {
  const filled = lines.flatMap((line, index) => line.trim() ? [index] : [])
  if (!filled.length) return []
  return lines.slice(filled[0], filled.at(-1)! + 1)
}

/**
 * Converts a stored summary from before issue 1473 (`{ text, link? }`): the
 * first non-empty line becomes the title, the remaining lines the
 * description. A title that had to be shortened keeps its full line at the
 * start of the description. Characters the current rules refuse are removed
 * (tabs become spaces, CR line ends become LF). Returns undefined when nothing
 * displayable remains.
 */
export function migrateLegacyGrantSummary(legacy: { text: string, link?: unknown }): OpenApeGrantSummary | undefined {
  const lines = withoutBlankEdges(legacy.text
    .replace(/\r\n?/g, '\n')
    .replaceAll('\t', ' ')
    .split('\n')
    .map(line => line.replace(HIDDEN_CHARACTERS, '').trimEnd()))
  const [first, ...rest] = lines
  if (!first) return undefined
  const line = first.trim()
  const title = truncate(line, LIMITS.title)
  const description = withoutBlankEdges(title === line ? rest : [line, ...rest]).join('\n')
  const link = typeof legacy.link === 'string' && legacy.link && codePointLength(legacy.link) <= LIMITS.link && !hasHiddenCharacter(legacy.link, false) ? legacy.link : undefined
  return {
    title,
    ...(description ? { description: truncate(description, LIMITS.description) } : {}),
    ...(link ? { link } : {}),
  }
}
