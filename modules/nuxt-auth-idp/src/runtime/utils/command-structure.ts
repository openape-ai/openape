/**
 * Readable structure of an exact command that no registry adapter describes
 * (issue 1477). The approval binds the whole argv, so the structure only
 * re-arranges it for reading: every token stays visible on the card and the
 * raw command line stays one disclosure away. Values that could read
 * differently from what the approval covers keep the raw rendering.
 */

// Control and format characters (bidi overrides, zero-width marks) could make
// a value read differently from what the approval covers.
export const HIDDEN_CHARACTERS = /[\p{Cc}\p{Cf}]/u
export const MAX_VALUE_LENGTH = 4096

const SUBCOMMAND = /^[A-Z][\w.:-]*$/i
const OPTION = /^--?[A-Z][\w.-]*$/i

/** A JSON object field; `entries` holds the fields of a nested object (one level). */
export interface CommandEntry {
  key: string
  /** Display text of a scalar, or the compact JSON of an object, array or deeper value. */
  value: string
  entries?: CommandEntry[]
}

export type CommandArgument =
  | { kind: 'object', option: string | null, entries: CommandEntry[] }
  | { kind: 'option', option: string, value: string | null }
  | { kind: 'value', value: string }

export interface CommandStructure {
  /** argv[0] as requested, including any directory. */
  program: string
  /** Leading plain words after the program (`approve`, `dns show`). */
  subcommands: string[]
  args: CommandArgument[]
}

/**
 * Splits an argv into program, leading subcommand words and arguments, or
 * returns null when the command must keep its raw rendering: no argv, a token
 * with control or format characters, or a line longer than 4096 characters.
 */
export function structureCommand(argv: readonly string[] | undefined): CommandStructure | null {
  if (!argv?.length) return null
  if (argv.join(' ').length > MAX_VALUE_LENGTH || argv.some(token => HIDDEN_CHARACTERS.test(token))) return null
  let index = 1
  const subcommands: string[] = []
  while (index < argv.length && SUBCOMMAND.test(argv[index]!)) subcommands.push(argv[index++]!)
  const args: CommandArgument[] = []
  while (index < argv.length) {
    const token = argv[index++]!
    if (OPTION.test(token)) {
      const next = argv[index]
      const hasValue = next !== undefined && !OPTION.test(next)
      if (hasValue) index++
      args.push(hasValue ? optionArgument(token, next) : { kind: 'option', option: token, value: null })
      continue
    }
    const entries = jsonObjectEntries(token)
    args.push(entries ? { kind: 'object', option: null, entries } : { kind: 'value', value: token })
  }
  return { program: argv[0]!, subcommands, args }
}

function optionArgument(option: string, value: string): CommandArgument {
  const entries = jsonObjectEntries(value)
  return entries ? { kind: 'object', option, entries } : { kind: 'option', option, value }
}

const LONG_COMMAND = 100

/** Whether the structure reads better than the raw line: a JSON object argument or a long line. */
export function worthStructuring(structure: CommandStructure, rawLength: number): boolean {
  return rawLength > LONG_COMMAND || structure.args.some(arg => arg.kind === 'object')
}

/**
 * Fields of a token that is a canonical JSON object (exactly what
 * `JSON.stringify` produces for it). Whitespace variants, duplicate keys and
 * escaped look-alikes stay plain, so two different tokens never render the
 * same fields. Keys and strings with hidden characters also stay plain.
 */
function jsonObjectEntries(token: string): CommandEntry[] | null {
  if (!token.startsWith('{')) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(token)
  }
  catch {
    return null
  }
  if (!isPlainObject(parsed) || JSON.stringify(parsed) !== token || containsHidden(parsed)) return null
  return Object.entries(parsed).map(([key, value]) => isPlainObject(value)
    ? { key, value: displayValue(value), entries: Object.entries(value).map(([inner, nested]) => ({ key: inner, value: displayValue(nested) })) }
    : { key, value: displayValue(value) })
}

/** JSON escapes such as `\u0007` decode to characters the raw token does not show. */
function containsHidden(value: unknown): boolean {
  if (typeof value === 'string') return HIDDEN_CHARACTERS.test(value)
  if (Array.isArray(value)) return value.some(containsHidden)
  if (isPlainObject(value)) return Object.entries(value).some(([key, inner]) => HIDDEN_CHARACTERS.test(key) || containsHidden(inner))
  return false
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

/**
 * Display text of a JSON value. A string is shown as is unless it could read
 * as another value (empty, padded, quoted or itself valid JSON such as `5`
 * or `true`); then it keeps its JSON quotes. Other values show as JSON.
 */
export function displayValue(value: unknown): string {
  if (typeof value !== 'string') return JSON.stringify(value)
  return ambiguousString(value) ? JSON.stringify(value) : value
}

function ambiguousString(value: string): boolean {
  if (value === '' || value.trim() !== value || value.startsWith('"')) return true
  try {
    JSON.parse(value)
    return true
  }
  catch {
    return false
  }
}

export interface CommandFact {
  /** `key:` of a JSON field or the option name; null for a plain argument. */
  label: string | null
  value: string
}

/** One-line form of a structure for a batch row. */
export interface CompactCommand {
  head: string
  facts: CommandFact[]
  /** Facts left out to keep the row short; the row says how many. */
  hidden: number
}

export interface CompactLimits {
  /** Longest head word. */
  head: number
  /** Longest fact value. */
  value: number
  /** Characters of the leading facts shown; the first fact is always shown. */
  facts: number
}

/** About three lines on a 390 px phone. */
export const COMPACT_LIMITS: CompactLimits = { head: 24, value: 15, facts: 72 }
/** Full values, used where a short form would hide a difference. */
const FULL_VALUES: CompactLimits = { head: Infinity, value: Infinity, facts: COMPACT_LIMITS.facts }

/** A fact with its position, which identifies it across commands of the same shape. */
interface PlacedFact extends CommandFact {
  id: string
}

function placedFacts(structure: CommandStructure, valueLimit: number): PlacedFact[] {
  return structure.args.flatMap(arg => argumentFacts(arg))
    .map((fact, index) => ({ id: `${index}:${fact.label}`, label: fact.label, value: truncateMiddle(fact.value, valueLimit) }))
}

function compactHead(structure: CommandStructure, limit: number): string {
  const name = structure.program.split('/').pop() || structure.program
  const program = name === structure.program ? name : `…/${name}`
  return [program, ...structure.subcommands].map(word => truncateMiddle(word, limit)).join(' ')
}

/**
 * Head (program name and subcommands) and facts in argv order: JSON fields as
 * `key: value` (nested fields as `parent.key`), options as `--name value`,
 * plain arguments as they are. Long values keep their start and end around a
 * visible ellipsis. Facts past the budget are counted in `hidden`, unless
 * `include` names them (see `distinctCompactCommands`).
 */
export function compactCommand(structure: CommandStructure, limits: CompactLimits = COMPACT_LIMITS, include: ReadonlySet<string> = new Set()): CompactCommand {
  const all = placedFacts(structure, limits.value)
  let used = 0
  const shown = all.filter((fact, index) => {
    used += (fact.label?.length ?? 0) + fact.value.length + 2
    return index === 0 || used <= limits.facts || include.has(fact.id)
  })
  return { head: compactHead(structure, limits.head), facts: shown.map(({ label, value }) => ({ label, value })), hidden: all.length - shown.length }
}

/**
 * Short forms for the rows of one list. Rows whose short forms read the same
 * although they bind different commands also show the first fact in which
 * they differ, then at full length; null keeps the raw line when even that
 * cannot tell them apart.
 */
export function distinctCompactCommands(structures: (CommandStructure | undefined)[]): (CompactCommand | null)[] {
  const identities = structures.map(structure => JSON.stringify(structure))
  let forms = structures.map(structure => structure ? compactCommand(structure) : null)
  for (const limits of [COMPACT_LIMITS, FULL_VALUES, null]) {
    const readings = forms.map(form => form && visibleText(form))
    const rivals = forms.map((form, index) => form ? structures.filter((_, at) => readings[at] === readings[index] && identities[at] !== identities[index]) as CommandStructure[] : [])
    if (rivals.every(list => !list.length)) break
    forms = forms.map((form, index) => {
      if (!rivals[index]!.length) return form
      if (!limits) return null
      const structure = structures[index]!
      const own = factValues(structure, limits.value)
      return compactCommand(structure, limits, new Set(rivals[index]!.flatMap(rival => firstDifference(own, factValues(rival, limits.value)))))
    })
  }
  return forms
}

/** What a reader sees: head, each fact box (a muted label reads like its value) and the hidden count. */
function visibleText(compact: CompactCommand): string {
  return JSON.stringify([compact.head, ...compact.facts.map(fact => fact.label ? `${fact.label} ${fact.value}` : fact.value), compact.hidden])
}

function factValues(structure: CommandStructure, valueLimit: number): Map<string, string> {
  return new Map(placedFacts(structure, valueLimit).map(fact => [fact.id, fact.value]))
}

/** The first fact in argv order whose value differs; both commands of a pair pick the same one. */
function firstDifference(own: Map<string, string>, other: Map<string, string>): string[] {
  const ids = [...new Set([...own.keys(), ...other.keys()])].toSorted((a, b) => Number.parseInt(a) - Number.parseInt(b) || a.localeCompare(b))
  return ids.filter(id => own.get(id) !== other.get(id)).slice(0, 1)
}

function argumentFacts(arg: CommandArgument): CommandFact[] {
  if (arg.kind === 'value') return [{ label: null, value: arg.value }]
  if (arg.kind === 'option') return [arg.value === null ? { label: null, value: arg.option } : { label: arg.option, value: arg.value }]
  const fields = arg.entries.flatMap(entry => entryFacts(entry))
  return arg.option ? [{ label: null, value: arg.option }, ...fields] : fields
}

/** Nested fields flatten to `parent.key`, unless a dotted key could read as another nesting. */
function entryFacts(entry: CommandEntry): CommandFact[] {
  const flat = entry.entries?.length && !entry.key.includes('.') && entry.entries.every(inner => !inner.key.includes('.'))
  if (!flat) return [{ label: `${entry.key}:`, value: entry.value }]
  return entry.entries!.map(inner => ({ label: `${entry.key}.${inner.key}:`, value: inner.value }))
}

/** Keeps start and end of a value around a visible ellipsis; counts code points. */
export function truncateMiddle(value: string, max: number): string {
  const characters = Array.from(value)
  if (characters.length <= max) return value
  const keep = max - 1
  const end = Math.floor(keep / 2) - 1
  return `${characters.slice(0, keep - end).join('')}…${characters.slice(characters.length - end).join('')}`
}

export type CommandBlock =
  | { kind: 'object', option: string | null, entries: CommandEntry[] }
  | { kind: 'list', items: string[] }

/** Card sections in argv order: each JSON object on its own, other arguments as lists. */
export function commandBlocks(structure: CommandStructure): CommandBlock[] {
  const blocks: CommandBlock[] = []
  for (const arg of structure.args) {
    if (arg.kind === 'object') {
      blocks.push({ kind: 'object', option: arg.option, entries: arg.entries })
      continue
    }
    const item = arg.kind === 'value' ? arg.value : [arg.option, arg.value].filter(part => part !== null).join(' ')
    const last = blocks.at(-1)
    if (last?.kind === 'list') last.items.push(item)
    else blocks.push({ kind: 'list', items: [item] })
  }
  return blocks
}
