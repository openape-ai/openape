/**
 * Approval presentation and tested CLI versions of a Shapes adapter.
 *
 * Adapters in the shapes-registry describe, per operation, what an approver
 * reads on the grant card (`[operation.presentation]`) and, per adapter, which
 * CLI versions the operations were checked against (`[cli] tested_versions`).
 * Both are parsed strictly: unknown keys, missing languages or bindings the
 * operation cannot produce are rejected, so a wrong adapter fails closed.
 */

/** Text shown to approvers, always in both supported languages. */
export interface LocalizedText {
  de: string
  en: string
}

/**
 * How a bound value is shown: `text` as prose, `code` as monospaced literal
 * (paths, refs), `map` as a key/value list read from a JSON object of strings.
 */
export type ShapePresentationFormat = 'text' | 'code' | 'map'

/** One labeled value taken from the operation's bindings. */
export interface ShapePresentationField {
  label: LocalizedText
  binding: string
  format?: ShapePresentationFormat
}

/** What an approval of this operation allows and what it does not allow. */
export interface ShapePresentationConsequence {
  allows: LocalizedText
  does_not_allow?: LocalizedText
}

/**
 * Conditions a request must meet for its card to use this presentation; a
 * request that does not meet them gets the generic card. `target_host` is a
 * template over always-bound bindings that must equal the request's target.
 */
export interface ShapePresentationRequirements {
  target_host?: string
}

/**
 * Card content of one operation. Texts may reference bindings that every
 * match binds as `{name}`; `facts` are shown directly, `details` behind a
 * disclosure with an optional `details_note` below them.
 */
export interface ShapePresentation {
  title: LocalizedText
  statement?: LocalizedText
  consequence?: ShapePresentationConsequence
  facts?: ShapePresentationField[]
  details?: ShapePresentationField[]
  details_note?: LocalizedText
  requires?: ShapePresentationRequirements
}

/**
 * CLI versions an adapter was checked against. `version_command` (arguments
 * after the executable) prints the version; the first capture group of
 * `version_pattern` must equal one of `tested_versions`.
 */
export interface ShapeCliVersions {
  tested_versions: string[]
  version_command: string[]
  version_pattern: string
}

const LANGUAGES = ['de', 'en'] as const
const BINDING_NAME = /^[\w-]+$/
const PLACEHOLDER = /\{([^{}]*)\}/g
// Control and format characters (bidi overrides, zero-width marks) could make
// a card read differently from its source.
const HIDDEN_CHARACTERS = /[\p{Cc}\p{Cf}]/u
const MAX_TEXT_LENGTH = 1000
const MAX_FIELDS = 12
const VERSION = /^[\w.+-]{1,64}$/
const VERSION_ARGUMENT = /^[\w.,:=@/+-]{1,64}$/

type Raw = Record<string, unknown>

function isRecord(value: unknown): value is Raw {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function assertKnownKeys(value: Raw, allowed: readonly string[], owner: string): void {
  const unknown = Object.keys(value).filter(key => !allowed.includes(key))
  if (unknown.length) throw new Error(`${owner} has unknown key(s): ${unknown.join(', ')}`)
}

/**
 * Bindings a presentation may reference. `always` are bound on every match
 * (positionals and required options) and may appear in texts; `any` adds
 * optional ones (declared and global options) for facts and details, which
 * are left out when unbound. `any` is null when the operation does not
 * declare its options: the legacy rule binds any `--name value`.
 */
export interface PresentationBindings {
  always: Set<string>
  any: Set<string> | null
}

export function presentationBindings(operation: {
  positionals?: string[]
  required_options?: string[]
  value_options?: string[]
  flag_options?: string[]
  global_options?: string[]
}): PresentationBindings {
  const always = new Set([
    ...(operation.positionals ?? []).filter(name => !name.startsWith('=')),
    ...(operation.required_options ?? []),
  ])
  if (operation.value_options === undefined && operation.flag_options === undefined) return { always, any: null }
  return {
    always,
    any: new Set([
      ...always,
      ...operation.value_options ?? [],
      ...operation.flag_options ?? [],
      ...(operation.global_options ?? []).map(entry => entry.split('=', 2)[1] || entry.split('=', 2)[0]!),
    ]),
  }
}

function assertBinding(name: string, bindings: Set<string> | null, owner: string): void {
  if (!BINDING_NAME.test(name)) throw new Error(`${owner} has an invalid binding name: ${JSON.stringify(name)}`)
  if (bindings && !bindings.has(name)) throw new Error(`${owner} references {${name}}, which the operation does not always bind`)
}

function parseText(value: unknown, owner: string, bindings: Set<string> | null): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${owner} must be a non-empty string`)
  if (value.length > MAX_TEXT_LENGTH) throw new Error(`${owner} is longer than ${MAX_TEXT_LENGTH} characters`)
  if (HIDDEN_CHARACTERS.test(value)) throw new Error(`${owner} contains control or format characters`)
  for (const [, name] of value.matchAll(PLACEHOLDER)) assertBinding(name!, bindings, owner)
  if (/[{}]/.test(value.replace(PLACEHOLDER, ''))) throw new Error(`${owner} has an unbalanced placeholder brace`)
  return value
}

function parseLocalized(value: unknown, owner: string, bindings: Set<string> | null): LocalizedText {
  if (!isRecord(value)) throw new Error(`${owner} must be a table with de and en texts`)
  assertKnownKeys(value, LANGUAGES, owner)
  return { de: parseText(value.de, `${owner}.de`, bindings), en: parseText(value.en, `${owner}.en`, bindings) }
}

function parseFields(value: unknown, owner: string, bindings: Set<string> | null): ShapePresentationField[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_FIELDS) throw new Error(`${owner} must list 1–${MAX_FIELDS} entries`)
  return value.map((entry, index) => {
    const fieldOwner = `${owner}[${index}]`
    if (!isRecord(entry)) throw new Error(`${fieldOwner} must be a table`)
    assertKnownKeys(entry, ['label', 'binding', 'format'], fieldOwner)
    if (typeof entry.binding !== 'string') throw new Error(`${fieldOwner}.binding must be a string`)
    assertBinding(entry.binding, bindings, `${fieldOwner}.binding`)
    if (entry.format !== undefined && !['text', 'code', 'map'].includes(entry.format as string)) throw new Error(`${fieldOwner}.format must be text, code or map`)
    return {
      label: parseLocalized(entry.label, `${fieldOwner}.label`, new Set()),
      binding: entry.binding,
      ...(entry.format === undefined ? {} : { format: entry.format as ShapePresentationFormat }),
    }
  })
}

/** Validates `[operation.presentation]` against the operation's `presentationBindings()`. */
export function parseShapePresentation(value: unknown, owner: string, bindings: PresentationBindings): ShapePresentation {
  const { always, any } = bindings
  const presentationOwner = `${owner} presentation`
  if (!isRecord(value)) throw new Error(`${presentationOwner} must be a table`)
  assertKnownKeys(value, ['title', 'statement', 'consequence', 'facts', 'details', 'details_note', 'requires'], presentationOwner)
  let requires: ShapePresentationRequirements | undefined
  if (value.requires !== undefined) {
    if (!isRecord(value.requires)) throw new Error(`${presentationOwner}.requires must be a table`)
    assertKnownKeys(value.requires, ['target_host'], `${presentationOwner}.requires`)
    requires = value.requires.target_host === undefined ? {} : { target_host: parseText(value.requires.target_host, `${presentationOwner}.requires.target_host`, always) }
  }
  let consequence: ShapePresentationConsequence | undefined
  if (value.consequence !== undefined) {
    if (!isRecord(value.consequence)) throw new Error(`${presentationOwner}.consequence must be a table`)
    assertKnownKeys(value.consequence, ['allows', 'does_not_allow'], `${presentationOwner}.consequence`)
    consequence = {
      allows: parseLocalized(value.consequence.allows, `${presentationOwner}.consequence.allows`, always),
      ...(value.consequence.does_not_allow === undefined ? {} : { does_not_allow: parseLocalized(value.consequence.does_not_allow, `${presentationOwner}.consequence.does_not_allow`, always) }),
    }
  }
  return {
    title: parseLocalized(value.title, `${presentationOwner}.title`, always),
    ...(value.statement === undefined ? {} : { statement: parseLocalized(value.statement, `${presentationOwner}.statement`, always) }),
    ...(consequence ? { consequence } : {}),
    ...(value.facts === undefined ? {} : { facts: parseFields(value.facts, `${presentationOwner}.facts`, any) }),
    ...(value.details === undefined ? {} : { details: parseFields(value.details, `${presentationOwner}.details`, any) }),
    ...(value.details_note === undefined ? {} : { details_note: parseLocalized(value.details_note, `${presentationOwner}.details_note`, always) }),
    ...(requires ? { requires } : {}),
  }
}

/**
 * Validates the version fields of `[cli]`. Returns undefined when none is
 * set; the three fields are only meaningful together.
 */
export function parseShapeCliVersions(cli: Raw, owner: string): ShapeCliVersions | undefined {
  const fields = ['tested_versions', 'version_command', 'version_pattern'] as const
  const present = fields.filter(field => cli[field] !== undefined)
  if (present.length === 0) return undefined
  if (present.length !== fields.length) throw new Error(`${owner} must set tested_versions, version_command and version_pattern together`)
  const { tested_versions: tested, version_command: command, version_pattern: pattern } = cli
  if (!Array.isArray(tested) || tested.length === 0 || tested.some(entry => typeof entry !== 'string' || !VERSION.test(entry)) || new Set(tested).size !== tested.length)
    throw new Error(`${owner} tested_versions must list distinct version strings`)
  if (!Array.isArray(command) || command.length > 8 || command.some(entry => typeof entry !== 'string' || !VERSION_ARGUMENT.test(entry)))
    throw new Error(`${owner} version_command must list up to 8 plain arguments`)
  if (typeof pattern !== 'string' || !pattern || pattern.length > 200) throw new Error(`${owner} version_pattern must be a regular expression`)
  let groups: number
  try { groups = new RegExp(`${pattern}|`).exec('')!.length - 1 }
  catch { throw new Error(`${owner} version_pattern is not a valid regular expression`) }
  if (groups < 1) throw new Error(`${owner} version_pattern needs a capture group for the version`)
  return { tested_versions: tested as string[], version_command: command as string[], version_pattern: pattern }
}

/** The version printed by `version_command`, or null when the output does not match `version_pattern`. */
export function readCliVersion(versions: ShapeCliVersions, output: string): string | null {
  return new RegExp(versions.version_pattern, 'm').exec(output)?.[1] ?? null
}
