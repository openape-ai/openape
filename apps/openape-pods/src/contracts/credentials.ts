export function parseCredentialAlias(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-z][a-z0-9_-]{0,63}$/.test(value)) throw new Error('Credential aliases must start with a lowercase letter and contain at most 64 lowercase letters, digits, underscores or hyphens')
  return value
}
export function parseCredentialValue(value: unknown): string {
  if (typeof value !== 'string' || !value.length || value.length > 16384 || value.includes('\0')) throw new Error('Credential values must contain 1 to 16384 characters without null bytes')
  return value
}
export function parseScriptCapabilities(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > 16 || new Set(value).size !== value.length) throw new Error('Invalid script capability set')
  for (const capability of value) {
    if (capability === 'mail.read' || (typeof capability === 'string' && /^tool\.[a-z][a-z0-9_-]{0,63}\.[a-z][a-z0-9_-]{0,31}$/.test(capability))) continue
    if (typeof capability !== 'string' || !capability.startsWith('credential.')) throw new Error('Unsupported script capability')
    parseCredentialAlias(capability.slice('credential.'.length))
  }
  return [...value] as string[]
}
export function credentialAliases(capabilities: string[]): string[] { return capabilities.filter(capability => capability.startsWith('credential.')).map(capability => parseCredentialAlias(capability.slice('credential.'.length))) }
export function parseCredentialRead(value: unknown): string {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== 1 || !('alias' in value)) throw new Error('Invalid script credential request')
  return parseCredentialAlias(value.alias)
}
