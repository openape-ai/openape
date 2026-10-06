export function canonicalNetworkJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalNetworkJson).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalNetworkJson((value as Record<string, unknown>)[key])}`).join(',')}}`
  }
  const result = JSON.stringify(value)
  if (result === undefined || (typeof value === 'number' && !Number.isFinite(value))) throw new Error('Invalid network JSON value')
  return result
}
