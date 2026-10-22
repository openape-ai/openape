import type { SealedSecret } from '#shared/vault-crypto'
import { and, eq, isNull } from 'drizzle-orm'
import { useDb } from '../database/drizzle'
import { vaultSecrets } from '../database/schema'
import { createProblemError } from './problem'
import { sealedField } from './vault-passkeys'

export const SECRET_TYPES = ['token', 'password', 'key', 'note'] as const
export type SecretType = typeof SECRET_TYPES[number]

/** Names agents ask for, like TELEGRAM_BOT_TOKEN: letters, digits, `_`, `-` and `.`. */
const ALIAS = /^[\w.-]{1,80}$/
const MAX_VALUE_BYTES = 64 * 1024

export function aliasField(value: unknown): string {
  if (typeof value !== 'string' || !ALIAS.test(value)) {
    throw createProblemError({ status: 400, title: 'Use a name of up to 80 letters, digits, _ - or .', detail: 'For example TELEGRAM_BOT_TOKEN.' })
  }
  return value
}

export function typeField(value: unknown): SecretType {
  if (!SECRET_TYPES.includes(value as SecretType)) throw createProblemError({ status: 400, title: `type must be one of ${SECRET_TYPES.join(', ')}` })
  return value as SecretType
}

/** A sealed version: the value (plus its 16-byte tag) and its DEK wrapped under the VMK (32 + 16 bytes). */
export function sealedSecretField(value: unknown): SealedSecret {
  const v = value as Partial<SealedSecret> | undefined
  return { value: sealedField(v?.value, 'sealed.value', MAX_VALUE_BYTES + 16), dek: sealedField(v?.dek, 'sealed.dek', 48) }
}

/** A live secret in this vault, or 404 — another owner's secret looks exactly like a missing one. */
export async function requireOwnSecret(vaultId: string, secretId: unknown) {
  const row = typeof secretId === 'string'
    ? await useDb().select().from(vaultSecrets).where(and(eq(vaultSecrets.id, secretId), eq(vaultSecrets.vaultId, vaultId), isNull(vaultSecrets.deletedAt))).get()
    : undefined
  if (!row) throw createProblemError({ status: 404, title: 'Secret not found' })
  return row
}
