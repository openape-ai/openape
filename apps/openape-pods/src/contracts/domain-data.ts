/**
 * Shared domain data of autonomous Pods (issue 1465): hierarchical namespaces with one writer and explicit readers.
 * A key is `<namespace>/<record>`; the record is one segment, so a key never crosses into a neighboring namespace.
 */
export const dataLimits = { valueBytes: 192 * 1024, listBytes: 200 * 1024, listEntries: 100, depth: 16, segments: 8, path: 200, record: 300, history: 20 } as const
export type DataMode = 'records' | 'results'
export type FieldType = 'string' | 'number' | 'integer' | 'boolean' | 'object' | 'array' | 'null'
/** The fields a namespace guarantees: required names and the JSON types each named field may have. */
export interface RecordSchema { required: string[], types: Record<string, FieldType[]> }
export const ownerWriter = 'owner'

const segment = /^[a-z0-9][a-z0-9._@+-]{0,63}$/
const record = /^[\w.@+=:~-]{1,300}$/
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/
const fieldTypes = new Set<FieldType>(['string', 'number', 'integer', 'boolean', 'object', 'array', 'null'])

export function namespacePath(value: unknown): string {
  if (typeof value !== 'string' || value.length > dataLimits.path) throw new Error('Invalid data namespace')
  const parts = value.split('/')
  if (!parts.length || parts.length > dataLimits.segments || parts.some(part => !segment.test(part))) throw new Error('Invalid data namespace')
  return value
}

export function recordKey(value: unknown): string {
  if (typeof value !== 'string' || !record.test(value)) throw new Error('Invalid data record key')
  return value
}

/** Splits a full key at its last segment; the namespace part must be registered to be usable. */
export function splitDataKey(value: unknown): { namespace: string, record: string } {
  if (typeof value !== 'string' || value.length > dataLimits.path + dataLimits.record + 1) throw new Error('Invalid data key')
  const slash = value.lastIndexOf('/')
  if (slash < 1) throw new Error('A data key needs a namespace and a record')
  return { namespace: namespacePath(value.slice(0, slash)), record: recordKey(value.slice(slash + 1)) }
}

export function dataWriter(value: unknown): string {
  if (value !== ownerWriter && (typeof value !== 'string' || !uuid.test(value))) throw new Error('A namespace writer is a Pod ID or the owner')
  return value
}

function plainObject(value: object): boolean {
  const prototype = Object.getPrototypeOf(value)
  return (prototype === Object.prototype || prototype === null) && !Object.getOwnPropertySymbols(value).length
}

/** A deep copy of plain JSON data; anything else (functions, cycles, non-finite numbers, getters) is refused. */
export function plainJson(value: unknown, depth = 0): unknown {
  if (depth > dataLimits.depth) throw new Error('Data value is nested too deeply')
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return value
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('Data value contains a non-finite number')
    return value
  }
  if (Array.isArray(value)) {
    if (Object.getPrototypeOf(value) !== Array.prototype) throw new Error('Data value must be plain JSON')
    return Array.from({ length: value.length }, (_, index) => {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index))
      if (!descriptor || !Object.hasOwn(descriptor, 'value')) throw new Error('Data value must be plain JSON')
      return plainJson(descriptor.value, depth + 1)
    })
  }
  if (typeof value === 'object' && plainObject(value)) {
    const output: Record<string, unknown> = {}
    for (const [name, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(value))) {
      if (!Object.hasOwn(descriptor, 'value') || !descriptor.enumerable) throw new Error('Data value must be plain JSON')
      if (descriptor.value !== undefined) output[name] = plainJson(descriptor.value, depth + 1)
    }
    return output
  }
  throw new Error('Data value must be plain JSON')
}

export function parseRecordSchema(value: unknown): RecordSchema {
  const input = plainJson(value) as Record<string, unknown>
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => !['required', 'types'].includes(key))) throw new Error('Invalid namespace schema')
  const types = input.types as Record<string, unknown>
  if (!types || typeof types !== 'object' || Array.isArray(types) || Object.keys(types).length > 64) throw new Error('Invalid namespace schema types')
  const parsed: Record<string, FieldType[]> = {}
  for (const [name, entry] of Object.entries(types)) {
    const list = Array.isArray(entry) ? entry : [entry]
    if (!name || name.length > 128 || !list.length || list.some(type => !fieldTypes.has(type as FieldType))) throw new Error('Invalid namespace schema field')
    parsed[name] = [...new Set(list as FieldType[])].sort()
  }
  const required = input.required ?? []
  if (!Array.isArray(required) || required.some(name => typeof name !== 'string' || !Object.hasOwn(parsed, name))) throw new Error('Invalid namespace schema required fields')
  return { required: [...new Set(required as string[])].sort(), types: parsed }
}

function typeOf(value: unknown): FieldType {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'array'
  if (typeof value === 'number') return Number.isSafeInteger(value) ? 'integer' : 'number'
  return typeof value as FieldType
}

/** A value fits a schema when it is an object, has every required field and every typed field has an allowed type. */
export function assertRecordSchema(value: unknown, schema: RecordSchema): void {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('A namespace with a schema stores objects')
  for (const name of schema.required) {
    if (!Object.hasOwn(value, name)) throw new Error(`Data value lacks required field ${name}`)
  }
  for (const [name, types] of Object.entries(schema.types)) {
    if (!Object.hasOwn(value, name)) continue
    const actual = typeOf((value as Record<string, unknown>)[name])
    if (!types.includes(actual) && !(actual === 'integer' && types.includes('number'))) throw new Error(`Data field ${name} has type ${actual}, expected ${types.join(' or ')}`)
  }
}

/** Equality filters on top-level scalar fields that decide which input entries an operation considers. */
export function parseWorkFilter(value: unknown): Record<string, string | number | boolean | null> {
  const input = plainJson(value ?? {}) as Record<string, unknown>
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).length > 8) throw new Error('Invalid work filter')
  for (const [name, item] of Object.entries(input)) {
    if (!name || name.length > 128 || (item !== null && !['string', 'number', 'boolean'].includes(typeof item))) throw new Error('Work filters compare top-level scalar fields')
  }
  return input as Record<string, string | number | boolean | null>
}
