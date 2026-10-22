import { and, eq, inArray, isNull } from 'drizzle-orm'
import { keyFingerprint } from '#shared/vault-crypto'
import { useDb } from '../database/drizzle'
import type { secretApprovals } from '../database/schema'
import { consumers, secretAccessRequests, vaultSecrets } from '../database/schema'
import { notifyOwner } from './notify'
import { createProblemError } from './problem'
import { nowSec } from './vault-passkeys'
import { sendTelegramMessage } from './telegram'

export type AccessRequestRow = typeof secretAccessRequests.$inferSelect
export type ApprovalRow = typeof secretApprovals.$inferSelect

export const DEFAULT_REQUEST_TTL_SEC = 24 * 60 * 60
export const MAX_REQUEST_TTL_SEC = 7 * 24 * 60 * 60
/** A one-time approval can be collected for this long. */
export const ONCE_COLLECT_WINDOW_SEC = 24 * 60 * 60
export const MAX_TIMED_SEC = 7 * 24 * 60 * 60

/** Status as callers see it: a pending request past its deadline has expired. */
export function requestStatus(row: AccessRequestRow, now = nowSec()): string {
  if (row.status === 'pending') return row.expiresAt <= now ? 'expired' : 'pending_approval'
  return row.status
}

/** Status as callers see it: active approvals end by time or by a newer secret version. */
export function approvalStatus(row: ApprovalRow, currentVersion: number | null, now = nowSec()): string {
  if (row.status !== 'active') return row.status
  if (currentVersion !== row.secretVersion) return 'superseded'
  if (row.expiresAt !== null && row.expiresAt <= now) return 'expired'
  return 'active'
}

/** Links to the vault always use its configured origin, never one taken from request headers. */
export function publicBase(): string {
  return String(useRuntimeConfig().vaultOrigin).replace(/\/$/, '')
}

export function fingerprintOf(publicKeyJwk: string): Promise<string> {
  return keyFingerprint(JSON.parse(publicKeyJwk) as JsonWebKey)
}

/** The live secret a request names: the pinned one if it still exists, otherwise by name. */
export async function liveSecretFor(row: AccessRequestRow) {
  const db = useDb()
  const live = and(eq(vaultSecrets.vaultId, row.vaultId), isNull(vaultSecrets.deletedAt))
  return (row.secretId ? await db.select().from(vaultSecrets).where(and(live, eq(vaultSecrets.id, row.secretId))).get() : undefined)
    ?? await db.select().from(vaultSecrets).where(and(live, eq(vaultSecrets.alias, row.fieldName))).get()
}

/** A request this owner received, or 404. */
export async function requireOwnRequest(owner: string, id: unknown): Promise<AccessRequestRow> {
  const row = typeof id === 'string'
    ? await useDb().select().from(secretAccessRequests).where(and(eq(secretAccessRequests.id, id), eq(secretAccessRequests.ownerEmail, owner))).get()
    : undefined
  if (!row) throw createProblemError({ status: 404, title: 'Request not found' })
  return row
}

/** Everything the owner needs to decide, for one or many requests. No values, no ciphertext. */
export async function ownerRequestViews(rows: AccessRequestRow[]) {
  if (!rows.length) return []
  const db = useDb()
  const machines = await db.select().from(consumers).where(inArray(consumers.id, [...new Set(rows.map(r => r.consumerId))])).all()
  return Promise.all(rows.map(async (row) => {
    const machine = machines.find(m => m.id === row.consumerId)
    const secret = await liveSecretFor(row)
    return {
      id: row.id,
      status: requestStatus(row),
      field_name: row.fieldName,
      purpose: row.purpose,
      requester: row.requester,
      requester_act: row.requesterAct,
      created_at: row.createdAt,
      expires_at: row.expiresAt,
      consumer: { id: row.consumerId, name: machine?.name ?? 'Unknown machine', fingerprint: row.consumerFingerprint, key_changed: !!machine && await fingerprintOf(machine.publicKeyJwk) !== row.consumerFingerprint },
      secret: secret ? { id: secret.id, alias: secret.alias, type: secret.type, version: secret.currentVersion } : null,
    }
  }))
}

/** What a requester may see about its own request. */
export function requesterView(row: AccessRequestRow, approvalId?: string) {
  return { id: row.id, status: requestStatus(row), field_name: row.fieldName, consumer_id: row.consumerId, expires_at: row.expiresAt, ...(approvalId ? { approval_id: approvalId } : {}) }
}

/** Announce a new request to the owner's chat, if one is configured for them. Never fails the request. */
export function announce(row: AccessRequestRow, consumerName: string, approveUrl: string) {
  const { telegramBotToken, telegramChatId, telegramApprover } = useRuntimeConfig()
  if (!telegramBotToken || !telegramChatId || !telegramApprover) return
  const text = formatApprovalMessage(row, consumerName, approveUrl)
  void notifyOwner(row.ownerEmail, text, {
    publicUrl: approveUrl,
    approver: String(telegramApprover),
    chatId: String(telegramChatId),
    send: (chatId, message) => sendTelegramMessage(String(telegramBotToken), chatId, message),
  }).catch(err => console.error('[notify] telegram', err))
}

/**
 * The owner's chat message. Who asks is always named with its kind; the reason
 * is the requester's own words, shown as a quote with links and line breaks
 * removed, so it cannot pose as instructions or as a second link to follow.
 */
export function formatApprovalMessage(row: Pick<AccessRequestRow, 'fieldName' | 'purpose' | 'requester' | 'requesterAct'>, consumerName: string, approveUrl: string): string {
  const reason = row.purpose.replace(/\b[a-z][\w+.-]*:\/\/\S+/gi, '[link removed]').replace(/\s+/g, ' ').trim().slice(0, 200)
  return [
    'Approval needed',
    '',
    `${row.fieldName} for ${consumerName}`,
    `Asked by ${row.requester} (${row.requesterAct === 'human' ? 'person' : 'agent'})`,
    ...(reason ? [`Reason given: “${reason}”`] : []),
    '',
    approveUrl,
  ].join('\n')
}
