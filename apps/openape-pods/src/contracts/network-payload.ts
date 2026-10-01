export type PayloadScalar = string | number | boolean | null
type ScalarType = 'string' | 'number' | 'integer' | 'boolean' | 'null'
export interface ScalarSchema { type: ScalarType, enum?: PayloadScalar[], maxLength?: number }
export interface ArraySchema { type: 'array', items: ScalarSchema, maxItems: number }
export interface PayloadSchema {
  type: 'object'
  properties: Record<string, ScalarSchema | ArraySchema>
  required: string[]
  additionalProperties: false
}

const scalarTypes = new Set(['string', 'number', 'integer', 'boolean', 'null'])
const encoder = new TextEncoder()
const owns = (value: object, key: string) => Object.hasOwn(value, key)

export function networkDataObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid network metadata object')
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) throw new Error('Invalid network metadata object')
  const descriptors = Object.getOwnPropertyDescriptors(value)
  if (Object.getOwnPropertySymbols(value).length || Object.values(descriptors).some(item => !Object.hasOwn(item, 'value') || !item.enumerable)) throw new Error('Network metadata must contain plain data properties')
  return Object.fromEntries(Object.entries(descriptors).map(([name, item]) => [name, item.value]))
}

function keywords(value: Record<string, unknown>, allowed: string[]): void {
  if (Object.keys(value).some(key => !allowed.includes(key))) throw new Error('Unsupported network schema keyword')
}

function array(value: unknown, maximum: number): unknown[] {
  if (!Array.isArray(value) || value.length > maximum || Object.getPrototypeOf(value) !== Array.prototype || Object.getOwnPropertySymbols(value).length) throw new Error('Network metadata array must contain bounded plain data')
  if (Object.getOwnPropertyNames(value).some(name => name !== 'length' && !/^(?:0|[1-9]\d*)$/.test(name))) throw new Error('Network metadata array must contain plain data')
  const result: unknown[] = []
  for (let index = 0; index < value.length; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index))
    if (!descriptor || !Object.hasOwn(descriptor, 'value')) throw new Error('Network metadata array must contain plain data')
    result.push(descriptor.value)
  }
  return result
}

function bound(value: unknown, maximum: number): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0 || (value as number) > maximum) throw new Error('Invalid network schema bound')
  return value as number
}

function matches(value: unknown, schema: ScalarSchema): value is PayloadScalar {
  switch (schema.type) {
    case 'null': return value === null
    case 'boolean': return typeof value === 'boolean'
    case 'string': return typeof value === 'string' && value.length <= 1024 && !/[\uD800-\uDFFF]/u.test(value) && (schema.maxLength === undefined || Array.from(value).length <= schema.maxLength)
    case 'integer': return typeof value === 'number' && Number.isSafeInteger(value)
    case 'number': return typeof value === 'number' && Number.isFinite(value)
  }
}

function scalar(value: unknown): ScalarSchema {
  const input = networkDataObject(value)
  keywords(input, ['type', 'enum', 'maxLength'])
  if (typeof input.type !== 'string' || !scalarTypes.has(input.type)) throw new Error('Unsupported network scalar type')
  const result: ScalarSchema = { type: input.type as ScalarType }
  if (owns(input, 'maxLength')) {
    if (result.type !== 'string') throw new Error('String bound requires a string schema')
    result.maxLength = bound(input.maxLength, 1024)
  }
  if (owns(input, 'enum')) {
    const choices = array(input.enum, 32)
    if (!choices.length || choices.some(item => !matches(item, result))) throw new Error('Invalid network scalar enum')
    if (new Set(choices.map(item => JSON.stringify(item))).size !== choices.length) throw new Error('Duplicate network scalar enum')
    result.enum = choices.sort((left, right) => JSON.stringify(left) < JSON.stringify(right) ? -1 : JSON.stringify(left) > JSON.stringify(right) ? 1 : 0) as PayloadScalar[]
  }
  return result
}

function field(value: unknown): ScalarSchema | ArraySchema {
  const input = networkDataObject(value)
  if (input.type !== 'array') return scalar(input)
  keywords(input, ['type', 'items', 'maxItems'])
  return { type: 'array', items: scalar(input.items), maxItems: bound(input.maxItems, 32) }
}

export function parsePayloadSchema(value: unknown): PayloadSchema {
  const input = networkDataObject(value)
  keywords(input, ['type', 'properties', 'required', 'additionalProperties'])
  if (input.type !== 'object' || input.additionalProperties !== false) throw new Error('Network schema must reject additional properties')
  const properties = networkDataObject(input.properties)
  if (Object.keys(properties).length > 32) throw new Error('Network schema exceeds 32 fields')
  const required = array(input.required, 32)
  if (required.some(key => typeof key !== 'string' || !owns(properties, key)) || new Set(required).size !== required.length) throw new Error('Invalid network required fields')
  const entries = Object.entries(properties).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0).map(([name, schema]) => {
    if (!name || name.length > 128 || name.includes('\0')) throw new Error('Invalid network field name')
    return [name, field(schema)] as const
  })
  const result: PayloadSchema = { type: 'object', properties: Object.fromEntries(entries), required: (required as string[]).sort(), additionalProperties: false }
  if (encoder.encode(JSON.stringify(result)).length > 16384) throw new Error('Network schema exceeds its size limit')
  return result
}

function validateScalar(value: unknown, schema: ScalarSchema): void {
  if (!matches(value, schema) || (schema.enum !== undefined && !schema.enum.includes(value))) throw new Error('Network metadata does not match its scalar schema')
}

export function validateNetworkPayload(value: unknown, schema: PayloadSchema): Record<string, unknown> {
  const input = networkDataObject(value)
  if (Object.keys(input).some(key => !owns(schema.properties, key)) || schema.required.some(key => !owns(input, key))) throw new Error('Network metadata fields do not match the schema')
  const entries: [string, PayloadScalar | PayloadScalar[]][] = []
  for (const [key, item] of Object.entries(input).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)) {
    const spec = schema.properties[key]!
    if (spec.type !== 'array') { validateScalar(item, spec); entries.push([key, item as PayloadScalar]); continue }
    const values = array(item, spec.maxItems)
    for (const entry of values) validateScalar(entry, spec.items)
    entries.push([key, values as PayloadScalar[]])
  }
  const output = Object.fromEntries(entries)
  const serialized = JSON.stringify(output)
  if (encoder.encode(serialized).length > 1024) throw new Error('Network metadata exceeds 1,024 bytes')
  return output
}
