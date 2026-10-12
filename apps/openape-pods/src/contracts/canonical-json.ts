/** Deterministic JSON: object keys sorted, so equal values always produce equal text and digests. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`).join(',')}}`
  }
  const result = JSON.stringify(value)
  if (result === undefined || (typeof value === 'number' && !Number.isFinite(value))) throw new Error('Invalid JSON value')
  return result
}
