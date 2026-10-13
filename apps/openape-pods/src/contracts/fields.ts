/** Plain data checks shared by definitions, sharing and dependency locks. */
export function plainObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid plain data object')
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) throw new Error('Invalid plain data object')
  const descriptors = Object.getOwnPropertyDescriptors(value)
  if (Object.getOwnPropertySymbols(value).length || Object.values(descriptors).some(item => !Object.hasOwn(item, 'value') || !item.enumerable)) throw new Error('Plain data must contain plain data properties')
  return Object.fromEntries(Object.entries(descriptors).map(([name, item]) => [name, item.value]))
}

export function dataFields(value: unknown, required: string[], optional: string[] = []): Record<string, unknown> {
  const input = plainObject(value)
  if (required.some(key => !Object.hasOwn(input, key)) || Object.keys(input).some(key => ![...required, ...optional].includes(key))) throw new Error('Unsupported data fields')
  return input
}

export function dataKey(value: unknown): string {
  // eslint-disable-next-line no-control-regex
  if (typeof value !== 'string' || !value || value.length > 200 || /[\u0000-\u001F\u007F\uD800-\uDFFF]/u.test(value)) throw new Error('Invalid data key')
  return value
}

export function dataIdentity(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value)) throw new Error('Invalid identity')
  return value
}

/** A public configuration value: a bounded scalar. */
export function publicConfiguration(value: unknown): string | number | boolean | null {
  if (value === null || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value)) || (typeof value === 'string' && value.length <= 1024)) return value
  throw new Error('Configuration values are bounded scalars')
}

/** Names the fields an MCP caller sent in the wrong place, so a refusal says what to move. */
export function unexpectedFields(message: string, fields: string[]): string {
  const hint = fields.includes('requestId') ? '; requestId belongs next to action, not inside command' : ''
  return `${message}: unexpected ${fields.join(', ')}${hint}`
}
