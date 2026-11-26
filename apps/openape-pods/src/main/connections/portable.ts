import { parseCredentialAlias, parseCredentialValue } from '../../contracts/credentials'

export interface PortableBinding { kind: 'http', podId: string, alias: string }
export interface PortableCredential { version: 1, id: string, binding: PortableBinding, value: Record<string, unknown> }

export function validatePortableValue(value: Record<string, unknown>, binding: PortableBinding): void {
  parseCredentialAlias(binding.alias)
  if (!/^[a-f0-9-]{36}$/.test(binding.podId) || value.kind !== 'script-credential' || value.podId !== binding.podId || value.alias !== binding.alias) throw new Error('HTTP credential binding does not match its assignment')
  parseCredentialValue(value.value)
}

export function parsePortableCredential(value: Record<string, unknown>, id: string): PortableCredential {
  const binding = value.binding as PortableBinding | undefined
  if (value.version !== 1 || value.id !== id || Object.keys(value).some(key => !['version', 'id', 'binding', 'value'].includes(key)) || !binding || binding.kind !== 'http' || !value.value || typeof value.value !== 'object' || Array.isArray(value.value)) throw new Error('Invalid portable credential record')
  if (Object.keys(binding).some(key => !['kind', 'podId', 'alias'].includes(key))) throw new Error('Invalid portable credential binding')
  validatePortableValue(value.value as Record<string, unknown>, binding)
  return value as unknown as PortableCredential
}
