import { networkDataObject, parsePayloadSchema } from './network-payload'
import type { PayloadScalar, PayloadSchema } from './network-payload'

export interface CollectionIndex { name: string, field: string }
export interface ArtifactReference { id: string, scope: string }
export interface CollectionContract { schema: PayloadSchema, indexes: CollectionIndex[] }

export function dataFields(value: unknown, required: string[], optional: string[] = []): Record<string, unknown> {
  const input = networkDataObject(value)
  if (required.some(key => !Object.hasOwn(input, key)) || Object.keys(input).some(key => ![...required, ...optional].includes(key))) throw new Error('Unsupported scoped data fields')
  return input
}

export function dataKey(value: unknown): string {
  // eslint-disable-next-line no-control-regex
  if (typeof value !== 'string' || !value || value.length > 200 || /[\u0000-\u001F\u007F\uD800-\uDFFF]/u.test(value)) throw new Error('Invalid scoped data key')
  return value
}

export function dataIdentity(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value)) throw new Error('Invalid identity')
  return value
}

export function dataRevision(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0 || Number(value) >= Number.MAX_SAFE_INTEGER) throw new Error('Invalid record revision')
  return value as number
}

export function artifactReference(value: unknown): ArtifactReference {
  const input = dataFields(value, ['id', 'scope'])
  if ([input.id, input.scope].some(item => typeof item !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(item))) throw new Error('Invalid scoped artifact reference')
  return input as unknown as ArtifactReference
}

export function artifactReferences(value: unknown): ArtifactReference[] {
  if (!Array.isArray(value) || value.length > 16) throw new Error('Artifact references exceed their limit')
  const references = value.map(artifactReference)
  if (new Set(references.map(item => item.id)).size !== references.length) throw new Error('Duplicate artifact reference')
  return references
}

export function collectionContract(schema: unknown, indexes: unknown): CollectionContract {
  const parsed = parsePayloadSchema(schema)
  if (!Array.isArray(indexes) || indexes.length > 16) throw new Error('Collection indexes exceed their limit')
  const declared = indexes.map((value) => {
    const input = dataFields(value, ['name', 'field'])
    const name = dataKey(input.name); const field = dataKey(input.field)
    if (!/^[a-z][a-z0-9-]{0,31}$/.test(name) || !Object.hasOwn(parsed.properties, field) || parsed.properties[field]!.type === 'array') throw new Error('Collection index requires a declared scalar field')
    return { name, field }
  })
  if (new Set(declared.map(item => item.name)).size !== declared.length) throw new Error('Duplicate collection index')
  return { schema: parsed, indexes: declared }
}

export function queryScalar(value: unknown): PayloadScalar {
  if (value === null || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value)) || (typeof value === 'string' && value.length <= 1024)) return value
  throw new Error('Collection query requires a bounded scalar')
}

export function publicConfiguration(value: unknown): PayloadScalar {
  return queryScalar(value)
}

export function secretReference(value: unknown): { kind: 'secret-reference', id: string } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Secret configuration requires a protected-store reference')
  const input = dataFields(value, ['kind', 'id'])
  if (input.kind !== 'secret-reference' || typeof input.id !== 'string' || !/^[a-f0-9-]{36}$/.test(input.id)) throw new Error('Secret configuration requires a protected-store reference')
  return { kind: 'secret-reference', id: input.id }
}
