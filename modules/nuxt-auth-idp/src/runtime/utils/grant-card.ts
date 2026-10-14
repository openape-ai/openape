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
 * a requester title can only add to it.
 */

export type CardLanguage = 'de' | 'en'

export interface RegistryCardField {
  label: LocalizedText
  format: ShapePresentationFormat
  value: string
  /** Key/value pairs of a `map` field; absent when the value is no JSON object of strings. */
  entries?: [string, string][]
}

/** A registry presentation rendered with the bindings the IdP derived from the grant's command. */
export interface RegistryCard {
  cli_id: string
  operation_id: string
  title: LocalizedText
  statement?: LocalizedText
  allows?: LocalizedText
  does_not_allow?: LocalizedText
  facts: RegistryCardField[]
  details: RegistryCardField[]
  details_note?: LocalizedText
}

/** What the IdP attaches to a grant response as `card`. */
export interface GrantCardContext {
  registry: RegistryCard | null
  /** The requester's registration at this IdP; null when it has none. */
  requester: { name: string, owner: string | null } | null
}

export type GrantWithCard = OpenApeGrant & { card?: GrantCardContext }

const PLACEHOLDER = /\{([\w-]+)\}/g

function renderText(text: LocalizedText, bindings: Record<string, string>): LocalizedText | null {
  let missing = false
  const render = (value: string) => value.replace(PLACEHOLDER, (_, name: string) => {
    const bound = bindings[name]
    if (bound === undefined) missing = true
    return bound ?? ''
  })
  const rendered = { de: render(text.de), en: render(text.en) }
  return missing ? null : rendered
}

function mapEntries(value: string): [string, string][] | undefined {
  try {
    const parsed: unknown = JSON.parse(value)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined
    const entries = Object.entries(parsed as Record<string, unknown>)
    return entries.every(([, entry]) => typeof entry === 'string') ? entries as [string, string][] : undefined
  }
  catch {
    return undefined
  }
}

function renderFields(fields: ShapePresentation['facts'], bindings: Record<string, string>): RegistryCardField[] {
  return (fields ?? []).flatMap((field) => {
    const value = bindings[field.binding]
    if (value === undefined) return []
    const format = field.format ?? 'text'
    const entries = format === 'map' ? mapEntries(value) : undefined
    return [{ label: field.label, format: format === 'map' && !entries ? 'code' : format, value, ...(entries ? { entries } : {}) }]
  })
}

/**
 * Renders an operation's presentation. Returns null when a text references a
 * binding that is not bound, so an incomplete card falls back to the command.
 */
export function renderRegistryCard(cliId: string, operationId: string, presentation: ShapePresentation, bindings: Record<string, string>): RegistryCard | null {
  const texts = {
    title: renderText(presentation.title, bindings),
    statement: presentation.statement ? renderText(presentation.statement, bindings) : undefined,
    allows: presentation.consequence ? renderText(presentation.consequence.allows, bindings) : undefined,
    does_not_allow: presentation.consequence?.does_not_allow ? renderText(presentation.consequence.does_not_allow, bindings) : undefined,
    details_note: presentation.details_note ? renderText(presentation.details_note, bindings) : undefined,
  }
  if (Object.values(texts).includes(null)) return null
  return {
    cli_id: cliId,
    operation_id: operationId,
    title: texts.title!,
    ...(texts.statement ? { statement: texts.statement } : {}),
    ...(texts.allows ? { allows: texts.allows } : {}),
    ...(texts.does_not_allow ? { does_not_allow: texts.does_not_allow } : {}),
    facts: renderFields(presentation.facts, bindings),
    details: renderFields(presentation.details, bindings),
    ...(texts.details_note ? { details_note: texts.details_note } : {}),
  }
}

export interface BindingLine {
  /** `registry`: the adapter's title; `command`: the exact command; `permission`: the requested permissions. */
  kind: 'registry' | 'command' | 'permission'
  text: string
  /** Shell that wrapped the command (`bash -c …`), shown as a badge. */
  shell?: string
}

/** The primary line of every card and batch row: what the approval binds. */
export function grantBindingLine(grant: GrantWithCard, language: CardLanguage): BindingLine {
  const registry = grant.card?.registry
  if (registry) return { kind: 'registry', text: registry.title[language] }
  const command = unwrapShellCommand(grant.request.command)
  if (command) return { kind: 'command', text: command.text, ...(command.shell ? { shell: command.shell } : {}) }
  const permissions = grant.request.permissions?.length
    ? grant.request.permissions
    : getCliAuthorizationDetails(grant.request.authorization_details).map(detail => detail.permission)
  if (permissions.length) return { kind: 'permission', text: permissions.join(', ') }
  return { kind: 'permission', text: `${grant.request.audience} · ${grant.request.target_host}` }
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
