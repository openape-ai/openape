import { parseCredentialAlias } from './credentials'

/**
 * Secrets through OpenApe Secrets: this desktop is a consumer with a P-256 key, a request names
 * an alias and a purpose, the owner fills it in the browser, the desktop collects the sealed
 * envelope once and stores the value under the alias. No value ever appears in these shapes.
 */
export type SecretRequestStatus = 'requested' | 'filled' | 'collected' | 'expired' | 'failed'
export interface SecretRequestRow { id: string, podId: string, alias: string, purpose: string, status: SecretRequestStatus, expiresAt: number, createdAt: number, updatedAt: number, error: string | null }
export interface SecretsView { consumer: { id: string, registeredAt: number } | null, requests: SecretRequestRow[], origin: string }
export type SecretsCommand = { type: 'list' } | { type: 'request', podId: string, alias: string, purpose: string } | { type: 'importFile', podId: string, alias: string } | { type: 'cancel', id: string } | { type: 'revokeConsumer' }
export const secretRequestStatuses: SecretRequestStatus[] = ['requested', 'filled', 'collected', 'expired', 'failed']
const uuid = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9-]{36}$/.test(value)
const requestId = (value: unknown): value is string => typeof value === 'string' && /^[\w-]{1,64}$/.test(value)

export function parseSecretsCommand(value: unknown): SecretsCommand {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid secrets command')
  const item = value as Record<string, unknown>
  const keys = item.type === 'list' || item.type === 'revokeConsumer' ? ['type'] : item.type === 'request' ? ['type', 'podId', 'alias', 'purpose'] : item.type === 'importFile' ? ['type', 'podId', 'alias'] : item.type === 'cancel' ? ['type', 'id'] : []
  if (!keys.length || Object.keys(item).some(key => !keys.includes(key))) throw new Error('Unsupported secrets command')
  if (item.type === 'request' || item.type === 'importFile') {
    if (!uuid(item.podId)) throw new Error('Invalid secrets request')
    parseCredentialAlias(item.alias)
    if (item.type === 'request' && (typeof item.purpose !== 'string' || item.purpose.length > 500 || item.purpose.includes('\0'))) throw new Error('Invalid secrets request purpose')
  }
  if (item.type === 'cancel' && !requestId(item.id)) throw new Error('Invalid secrets request identity')
  return structuredClone(item) as SecretsCommand
}

export function parseSecretsView(value: unknown): SecretsView {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid secrets view')
  const view = value as SecretsView
  if (typeof view.origin !== 'string' || !Array.isArray(view.requests) || view.requests.length > 200) throw new Error('Invalid secrets view')
  if (view.consumer !== null && (!view.consumer || typeof view.consumer.id !== 'string' || !Number.isSafeInteger(view.consumer.registeredAt))) throw new Error('Invalid secrets consumer')
  for (const row of view.requests) parseSecretRequestRow(row)
  return view
}

export function parseSecretRequestRow(value: unknown): SecretRequestRow {
  const row = value as SecretRequestRow
  if (!row || !requestId(row.id) || !uuid(row.podId) || !secretRequestStatuses.includes(row.status) || typeof row.purpose !== 'string' || !Number.isSafeInteger(row.expiresAt) || !Number.isSafeInteger(row.createdAt) || !Number.isSafeInteger(row.updatedAt) || (row.error !== null && typeof row.error !== 'string')) throw new Error('Invalid secret request')
  parseCredentialAlias(row.alias)
  return row
}
