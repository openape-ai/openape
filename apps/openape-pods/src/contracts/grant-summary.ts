import type { OpenApeGrantBatch, OpenApeGrantSummary } from '@openape/core'
import { parseGrantBatch, parseGrantSummary } from '@openape/grants'
import type { RunContext } from './services'

/**
 * The DDISA request summary (grants.md §3.4, issue 1473): the requester's own claim of what a grant request is about.
 * The IdP decides how it is presented; Pods only passes it through. A script may name `title`, `description` and
 * `link`; the desktop adds `origin`, the Pod's name. Without a script title the desktop sends a neutral title taken
 * from data (a permission's display, the exact command line, the message subject), never composed prose.
 */
export type GrantSummary = OpenApeGrantSummary
/** What a script may claim; `origin` is always the desktop's. */
export type ScriptSummary = Partial<Pick<GrantSummary, 'title' | 'description' | 'link'>>

export const grantSummaryLimits = { title: 120, origin: 120 } as const

/**
 * A complete summary, checked with the protocol's rules (@openape/grants) plus the one Pods adds for a link it passes
 * on: an http or https URL without credentials.
 */
export function parseSummary(value: unknown): GrantSummary {
  const summary = parseGrantSummary(value ?? {})!
  const url = summary.link === undefined ? undefined : URL.parse(summary.link)
  if (url !== undefined && (!url || !['http:', 'https:'].includes(url.protocol) || url.username || url.password)) throw new Error('A summary link is an http or https URL without credentials')
  return summary
}

/** A script's summary, checked where it enters: an invalid one is refused, never shortened or cleaned. */
export function parseScriptSummary(value: unknown): ScriptSummary {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !['title', 'description', 'link'].includes(key))) throw new Error('A summary names only title, description and link')
  const claim = value as Record<string, unknown>
  // A script may leave the title to the desktop; its other fields are then checked beside a stand-in title.
  const { title, ...checked } = parseSummary({ ...claim, title: claim.title ?? 'untitled' })
  return { ...(claim.title === undefined ? {} : { title }), ...checked }
}

/**
 * Data the desktop shows as a title or origin (a command line, a message subject, a Pod name) as one line that
 * fits: hidden characters become spaces and a longer value ends with an ellipsis. Empty data yields `fallback`.
 */
export function summaryLine(value: string, limit: number, fallback = '–'): string {
  const text = value.replace(/[\p{Cc}\p{Cf}\p{Cs}\s]+/gu, ' ').trim()
  if (!text) return fallback
  if (text.length <= limit) return text
  let shortened = ''
  for (const character of text) {
    if (shortened.length + character.length > limit - 1) break
    shortened += character
  }
  return `${shortened.trimEnd()}…`
}

/** The summary of one request: the script's claim where given, a data title otherwise, and the Pod as origin. */
export function grantSummary(dataTitle: string, origin?: string, script: ScriptSummary = {}): GrantSummary {
  return {
    title: script.title ?? summaryLine(dataTitle, grantSummaryLimits.title),
    ...(script.description === undefined ? {} : { description: script.description }),
    ...(origin === undefined ? {} : { origin: summaryLine(origin, grantSummaryLimits.origin, 'Pod') }),
    ...(script.link === undefined ? {} : { link: script.link }),
  }
}

export function savedScriptSummary(context: RunContext): GrantSummary {
  const reason = { manual: 'Manual start', schedule: 'Scheduled start', event: 'Event-triggered start' }[context.reason]
  const label = 'Pod context:\n'
  const footer = `\n\n${reason}. Tool and HTTP calls require their own permissions.`
  const description = context.description?.trim()
    ? `${label}${summaryLine(context.description, 2000 - label.length - footer.length)}${footer}`
    : `Run the selected saved script.\n${reason}.`
  return parseSummary(grantSummary(`Run saved script: ${context.name}`, context.name, { description }))
}

/**
 * Splits approval presentation from the call, keeping the call and its effect identity unchanged.
 */
export function splitScriptSummary(payload: unknown): { payload: unknown, summary?: ScriptSummary, batch?: OpenApeGrantBatch } {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload) || !['summary', 'batch'].some(key => Object.hasOwn(payload, key))) return { payload }
  const { summary, batch, ...call } = payload as Record<string, unknown>
  return { payload: call, ...(Object.hasOwn(payload, 'summary') ? { summary: parseScriptSummary(summary) } : {}), ...(batch === undefined ? {} : { batch: parseGrantBatch(batch) }) }
}
