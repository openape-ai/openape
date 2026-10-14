import type { OpenApeGrant } from '@openape/core'
import type { LocalizedText, ShapePresentation, ShapePresentationFormat } from '@openape/grants'
import { getCliAuthorizationDetails } from './cli-grants'
import { unwrapShellCommand } from './command-display'

/**
 * One generic grant card (issue 1473). Three labeled sources answer the
 * approver's questions: the registry adapter the IdP holds (what happens and
 * what it means), the IdP's own records (who asks, grant type, validity) and
 * the requester's summary (its claim). The binding identity — the registry
 * title or, without one, the exact command — always stays the primary line;
 * a requester title can only add to it, and registry values the approval does
 * not bind carry an "as requested" marker.
 */

export type CardLanguage = 'de' | 'en'

/**
 * `bound`: the approval binds the value (a selector of the permission, or any
 * part of an exact command); `requested`: the requester supplied it and the
 * approval does not hold it to that value.
 */
export type Provenance = 'bound' | 'requested'

/** A rendered text; `requested` marks one that contains values the approval does not bind. */
export interface RegistryText extends LocalizedText {
  requested?: true
}

export interface RegistryCardField {
  label: LocalizedText
  format: ShapePresentationFormat
  value: string
  provenance: Provenance
  /** Key/value pairs of a `map` field. */
  entries?: [string, string][]
}

/** A registry presentation rendered with the bindings the IdP derived from the grant's argv. */
export interface RegistryCard {
  cli_id: string
  operation_id: string
  title: RegistryText
  statement?: RegistryText
  allows?: RegistryText
  does_not_allow?: RegistryText
  facts: RegistryCardField[]
  details: RegistryCardField[]
  details_note?: RegistryText
}

/** What the IdP attaches to a grant response as `card`. */
export interface GrantCardContext {
  registry: RegistryCard | null
  /** The requester's registration at this IdP; null when it has none. */
  requester: { name: string, owner: string | null } | null
}

export type GrantWithCard = OpenApeGrant & { card?: GrantCardContext }

export interface RegistryCardInput {
  cliId: string
  operationId: string
  presentation: ShapePresentation
  bindings: Record<string, string>
  /** Names of the bindings the approval binds (see `Provenance`). */
  bound: ReadonlySet<string>
  /** The request's `target_host`, checked against `presentation.requires`. */
  targetHost: string
}

const PLACEHOLDER = /\{([\w-]+)\}/g
// Control and format characters (bidi overrides, zero-width marks) could make
// a value read differently from what the approval covers.
const HIDDEN_CHARACTERS = /[\p{Cc}\p{Cf}]/u
const MAX_VALUE_LENGTH = 4096
const MAX_MAP_LENGTH = 16000
const MAX_MAP_ENTRIES = 64

class UnrenderableValue extends Error {}

function safe(value: string, maxLength = MAX_VALUE_LENGTH): string {
  if (value.length > maxLength || HIDDEN_CHARACTERS.test(value)) throw new UnrenderableValue()
  return value
}

function renderTemplate(template: string, bindings: Record<string, string>, used: Set<string>): string {
  return template.replace(PLACEHOLDER, (_, name: string) => {
    const value = bindings[name]
    if (value === undefined) throw new UnrenderableValue()
    used.add(name)
    return safe(value)
  })
}

function renderText(text: LocalizedText, input: RegistryCardInput): RegistryText {
  const used = new Set<string>()
  const rendered = { de: renderTemplate(text.de, input.bindings, used), en: renderTemplate(text.en, input.bindings, used) }
  return [...used].some(name => !input.bound.has(name)) ? { ...rendered, requested: true } : rendered
}

function mapEntries(value: string): [string, string][] {
  let parsed: unknown
  try {
    parsed = JSON.parse(safe(value, MAX_MAP_LENGTH))
  }
  catch {
    throw new UnrenderableValue()
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new UnrenderableValue()
  const entries = Object.entries(parsed as Record<string, unknown>)
  if (entries.length > MAX_MAP_ENTRIES) throw new UnrenderableValue()
  return entries.map(([key, entry]) => {
    if (typeof entry !== 'string') throw new UnrenderableValue()
    return [safe(key), safe(entry)]
  })
}

function renderFields(fields: ShapePresentation['facts'], input: RegistryCardInput): RegistryCardField[] {
  return (fields ?? []).flatMap((field): RegistryCardField[] => {
    const value = input.bindings[field.binding]
    if (value === undefined) return []
    const format = field.format ?? 'text'
    const provenance: Provenance = input.bound.has(field.binding) ? 'bound' : 'requested'
    if (format === 'map') return [{ label: field.label, format, value, provenance, entries: mapEntries(value) }]
    return [{ label: field.label, format, value: safe(value), provenance }]
  })
}

/**
 * Renders an operation's presentation, or returns null so the card falls back
 * to the exact command: when a text needs a binding that is not bound, a value
 * is oversized or contains control or format characters, a map is no small
 * JSON object of strings, or the request misses `presentation.requires`.
 */
export function renderRegistryCard(input: RegistryCardInput): RegistryCard | null {
  const { presentation } = input
  try {
    const target = presentation.requires?.target_host
    if (target !== undefined && renderTemplate(target, input.bindings, new Set()) !== input.targetHost) return null
    const consequence = presentation.consequence
    return {
      cli_id: input.cliId,
      operation_id: input.operationId,
      title: renderText(presentation.title, input),
      ...(presentation.statement ? { statement: renderText(presentation.statement, input) } : {}),
      ...(consequence ? { allows: renderText(consequence.allows, input) } : {}),
      ...(consequence?.does_not_allow ? { does_not_allow: renderText(consequence.does_not_allow, input) } : {}),
      facts: renderFields(presentation.facts, input),
      details: renderFields(presentation.details, input),
      ...(presentation.details_note ? { details_note: renderText(presentation.details_note, input) } : {}),
    }
  }
  catch (error) {
    if (error instanceof UnrenderableValue) return null
    throw error
  }
}

export interface BindingLine {
  /** `registry`: the adapter's title; `command`: the exact command; `permission`: the requested permissions. */
  kind: 'registry' | 'command' | 'permission'
  text: string
  /** A registry title with values the approval does not bind; shown with an "as requested" marker. */
  requested?: true
  /** Shell that wrapped the command (`bash -c …`), shown as a badge. */
  shell?: string
}

/** The primary line of every card and batch row: what the approval binds. */
export function grantBindingLine(grant: GrantWithCard, language: CardLanguage): BindingLine {
  const registry = grant.card?.registry
  if (registry) return { kind: 'registry', text: registry.title[language], ...(registry.title.requested ? { requested: true as const } : {}) }
  const command = unwrapShellCommand(grant.request.command)
  if (command) return { kind: 'command', text: command.text, ...(command.shell ? { shell: command.shell } : {}) }
  const permissions = grant.request.permissions?.length
    ? grant.request.permissions
    : getCliAuthorizationDetails(grant.request.authorization_details).map(detail => detail.permission)
  if (permissions.length) return { kind: 'permission', text: permissions.join(', ') }
  return { kind: 'permission', text: `${grant.request.audience} · ${grant.request.target_host}` }
}

/** The approver-facing marker for values the approval does not bind. */
export function requestedMarker(language: CardLanguage): string {
  return language === 'de' ? 'laut Anfrage' : 'as requested'
}

/** Requested validity in the approver's language: single use, a duration or until revoked. */
export function grantValidity(grant: OpenApeGrant, language: CardLanguage): string {
  const german = language === 'de'
  const type = grant.request.grant_type ?? 'once'
  if (type === 'always') return german ? 'Dauerhaft, bis zum Widerruf' : 'Continuing, until revoked'
  if (type === 'timed') {
    const minutes = Math.round((grant.request.duration ?? 0) / 60)
    const span = minutes >= 60 ? `${Math.round(minutes / 60)} h` : `${minutes} min`
    return german ? `Befristet, ${span}` : `Timed, ${span}`
  }
  return german ? 'Einmalig' : 'Single use'
}
