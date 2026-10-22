import { and, eq, isNull } from 'drizzle-orm'
import { defineEventHandler, readBody, setResponseStatus } from 'h3'
import { ulid } from 'ulid'
import { useDb } from '../../../database/drizzle'
import { secretAccessRequests, vaults, vaultSecrets } from '../../../database/schema'
import { loadConsumer } from '../../../utils/access'
import { createProblemError } from '../../../utils/problem'
import { rateLimit } from '../../../utils/rate-limit'
import { nowSec } from '../../../utils/vault-passkeys'
import { announce, DEFAULT_REQUEST_TTL_SEC, fingerprintOf, MAX_REQUEST_TTL_SEC, publicBase, requesterView } from '../../../utils/vault-requests'
import { aliasField } from '../../../utils/vault-secrets'

/**
 * POST /api/v2/requests — an agent (or the owner) asks for one vault secret by
 * name, for one machine. The answer never says whether the name exists: an
 * unknown name waits for the owner exactly like a known one, so requests cannot
 * be used to list someone's vault.
 *
 * Body: `{ consumerId, secret, purpose?, ttlSec? }`.
 */
export default defineEventHandler(async (event) => {
  if (!useRuntimeConfig().vaultEnabled) throw createProblemError({ status: 404, title: 'Not found' })
  const caller = await requireCaller(event)
  rateLimit(event, `request:${caller.email}`)
  const body = (await readBody<Record<string, unknown>>(event)) ?? {}
  const consumerId = typeof body.consumerId === 'string' ? body.consumerId : ''
  const fieldName = aliasField(body.secret)
  const consumer = await loadConsumer(consumerId, caller.email)

  const db = useDb()
  const vault = await db.select({ id: vaults.id }).from(vaults).where(eq(vaults.ownerEmail, consumer.ownerEmail)).get()
  if (!vault) throw createProblemError({ status: 409, title: 'The owner of this machine has no vault yet' })
  const secret = await db.select().from(vaultSecrets).where(and(eq(vaultSecrets.vaultId, vault.id), eq(vaultSecrets.alias, fieldName), isNull(vaultSecrets.deletedAt))).get()

  const ttl = Number.isFinite(Number(body.ttlSec)) ? Math.min(MAX_REQUEST_TTL_SEC, Math.max(60, Math.floor(Number(body.ttlSec)))) : DEFAULT_REQUEST_TTL_SEC
  const now = nowSec()
  const row = {
    id: ulid(),
    vaultId: vault.id,
    ownerEmail: consumer.ownerEmail,
    requester: caller.email,
    requesterAct: caller.act,
    consumerId: consumer.id,
    consumerFingerprint: await fingerprintOf(consumer.publicKeyJwk),
    fieldName,
    secretId: secret?.id ?? null,
    secretVersion: secret?.currentVersion ?? null,
    purpose: typeof body.purpose === 'string' ? body.purpose.trim().slice(0, 500) : '',
    status: 'pending' as const,
    expiresAt: now + ttl,
    createdAt: now,
    decidedAt: null,
  }
  await db.insert(secretAccessRequests).values(row)

  const approveUrl = `${publicBase()}/approve/${row.id}`
  announce(row, consumer.name, approveUrl)
  setResponseStatus(event, 201)
  return { ...requesterView(row), approve_url: approveUrl }
})
