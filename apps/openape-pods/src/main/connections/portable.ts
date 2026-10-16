import { parseCredentialAlias, parseCredentialValue } from '../../contracts/credentials'

export type PortableBinding = { kind: 'http', podId: string, alias: string } | { kind: 'chatgpt', accountId: string }
export interface PortableCredential { version: 1, id: string, binding: PortableBinding, value: Record<string, unknown> }

export function validatePortableValue(value: Record<string, unknown>, binding: PortableBinding): void {
  if (binding.kind === 'http') {
    parseCredentialAlias(binding.alias)
    if (!/^[a-f0-9-]{36}$/.test(binding.podId) || value.kind !== 'script-credential' || value.podId !== binding.podId || value.alias !== binding.alias) throw new Error('HTTP credential binding does not match its assignment')
    parseCredentialValue(value.value)
    return
  }
  const tokens = value.tokens as Record<string, unknown> | undefined
  if (typeof binding.accountId !== 'string' || !binding.accountId || binding.accountId.length >= 32768 || (value.auth_mode !== undefined && value.auth_mode !== 'chatgpt') || !tokens || tokens.account_id !== binding.accountId || ![tokens.access_token, tokens.refresh_token].every(item => typeof item === 'string' && item.length > 0 && item.length < 32768)) throw new Error('ChatGPT credential account binding does not match; reconnect')
}

export function parsePortableCredential(value: Record<string, unknown>, id: string): PortableCredential {
  const binding = value.binding as PortableBinding | undefined
  if (value.version !== 1 || value.id !== id || Object.keys(value).some(key => !['version', 'id', 'binding', 'value'].includes(key)) || !binding || !['http', 'chatgpt'].includes(binding.kind) || !value.value || typeof value.value !== 'object' || Array.isArray(value.value)) throw new Error('Invalid portable credential record')
  const keys = binding.kind === 'http' ? ['kind', 'podId', 'alias'] : ['kind', 'accountId']
  if (Object.keys(binding).some(key => !keys.includes(key))) throw new Error('Invalid portable credential binding')
  validatePortableValue(value.value as Record<string, unknown>, binding)
  return value as unknown as PortableCredential
}
