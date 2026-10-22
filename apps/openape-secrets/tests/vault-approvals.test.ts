import type { Caller, SetupOptions } from './support/vault'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createTestAuthenticator } from '../../../packages/auth/src/__tests__/webauthn-test-authenticator'
import { createSigningKey, keyFingerprint, openDelivery, openSecret, openSigningKey, sealDelivery, sealSecret, signDelivery, verifyDelivery } from '../shared/vault-crypto'
import { call, caller, ORIGIN, RP_ID, status, VAULT_TABLE_NAMES, vaultSetupBody } from './support/vault'

// Agents ask for a vault secret for one of the owner's machines; the owner
// approves one exact handover with a fresh passkey. These tests are mostly
// about who cannot approve, and what an approval can never be moved to.

vi.mock('../server/database/drizzle', async () => {
  const { createClient } = await import('@libsql/client')
  const { drizzle } = await import('drizzle-orm/libsql')
  const schema = await import('../server/database/schema')
  const { applyVaultSchema } = await import('../server/database/vault-tables')
  const client = createClient({ url: 'file::memory:?cache=shared' })
  await client.execute(`CREATE TABLE IF NOT EXISTS consumers (id TEXT PRIMARY KEY, owner_email TEXT NOT NULL, name TEXT NOT NULL, public_key_jwk TEXT NOT NULL, allowed_requesters TEXT NOT NULL DEFAULT '[]', created_at INTEGER NOT NULL)`)
  await applyVaultSchema(statement => client.execute(statement))
  return { useDb: () => drizzle(client, { schema }) }
})
vi.mock('h3', async () => ({ ...(await import('./support/vault')).h3Mock(), getRequestURL: () => new URL('https://secrets.test/') }))
vi.stubGlobal('useRuntimeConfig', () => ({ vaultEnabled: true, vaultRpId: RP_ID, vaultOrigin: ORIGIN, publicUrl: ORIGIN, telegramBotToken: '', telegramChatId: '', telegramApprover: '' }))
vi.stubGlobal('getSpSession', async (e: { __session?: unknown }) => ({ data: e.__session ?? {} }))
// requireCaller accepts browser sessions and bearer tokens alike.
vi.stubGlobal('requireCaller', async (e: { __bearer?: Caller, __session?: { claims?: Caller } }) => {
  const who = e.__bearer ?? e.__session?.claims
  if (!who?.email) throw Object.assign(new Error('Unauthorized'), { statusCode: 401 })
  return { email: who.email, act: who.act === 'human' ? 'human' : 'agent' }
})

const setupOptions = (await import('../server/api/v2/vault/setup/options.post')).default
const setupCommit = (await import('../server/api/v2/vault/setup/commit.post')).default
const actionOptions = (await import('../server/api/v2/vault/actions/options.post')).default
const actionCommit = (await import('../server/api/v2/vault/actions/commit.post')).default
const createRequest = (await import('../server/api/v2/requests/index.post')).default
const listRequests = (await import('../server/api/v2/requests/index.get')).default
const readRequest = (await import('../server/api/v2/requests/[id].get')).default
const approvalOptions = (await import('../server/api/v2/requests/[id]/approval/options.post')).default
const approvalCommit = (await import('../server/api/v2/requests/[id]/approval/commit.post')).default
const denyRequest = (await import('../server/api/v2/requests/[id]/deny.post')).default
const listApprovals = (await import('../server/api/v2/approvals/index.get')).default
const revokeApproval = (await import('../server/api/v2/approvals/[id]/revoke.post')).default
const collectApproval = (await import('../server/api/v2/approvals/[id]/collect.post')).default
const readApproval = (await import('../server/api/v2/approvals/[id].get')).default
const { sweepApprovalPackages } = await import('../server/utils/vault-requests')
const { useDb } = await import('../server/database/drizzle')
const { consumers, secretApprovals, vaults } = await import('../server/database/schema')
const { eq } = await import('drizzle-orm')

let signCount = 0
const AGENT: Caller = { email: 'mail-triage@agents.example', act: 'agent' }

/** A request from an agent holding a bearer token, not a browser session. */
function asAgent<T>(handler: unknown, body?: unknown, method = 'POST', params: Record<string, string> = {}, agent = AGENT): Promise<T> {
  return (handler as (e: never) => Promise<T>)({ __body: body, __method: method, __headers: {}, __bearer: agent, context: { params } } as never)
}

async function world() {
  const me = caller()
  const opts = await call<SetupOptions>(setupOptions, me)
  const vault = { ...await vaultSetupBody(opts), id: opts.vaultId, me }
  await call(setupCommit, me, vault.body)

  const pair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])
  const { kty, crv, x, y } = await crypto.subtle.exportKey('jwk', pair.publicKey)
  const machine = { id: `c-${Math.random().toString(36).slice(2)}`, publicJwk: { kty, crv, x, y } as JsonWebKey, privateJwk: await crypto.subtle.exportKey('jwk', pair.privateKey) }
  await useDb().insert(consumers).values({ id: machine.id, ownerEmail: me.email!, name: 'Mac mini', publicKeyJwk: JSON.stringify(machine.publicJwk), allowedRequesters: JSON.stringify([AGENT.email]), createdAt: 1 })
  return { vault, machine, me }
}

type World = Awaited<ReturnType<typeof world>>

async function saveSecret(w: World, alias: string, value: string, secretId?: string) {
  const opts = await call<{ challengeId: string, vaultId: string, secretId: string, version: number, assertion: { challenge: string } }>(actionOptions, w.me, { action: 'secret.save', secretId })
  const assertion = w.vault.passkey.createAuthenticationResponse({ challenge: opts.assertion.challenge, origin: ORIGIN, rpId: RP_ID, counter: ++signCount })
  const sealed = await sealSecret(w.vault.vmk, value, { vaultId: opts.vaultId, secretId: opts.secretId, version: opts.version })
  return call<{ secret_id: string, version: number }>(actionCommit, w.me, { challengeId: opts.challengeId, assertion, alias, type: 'token', sealed })
}

interface RequestView { id: string, status: string, field_name: string }
interface OwnerRequest extends RequestView { secret: { id: string, alias: string, version: number } | null, consumer: { id: string, name: string, fingerprint: string } }
interface ApprovalOptions {
  challengeId: string
  approvalId: string
  descriptor: { secretId: string, version: number, consumerKeyFingerprint: string, mode: string, expiresAt: number | null }
  consumer: { publicKeyJwk: JsonWebKey }
  sealed: Parameters<typeof openSecret>[1] | null
  signing: { keyWrap: { iv: string, ct: string } } | null
  assertion: { challenge: string }
}

/** The owner's browser: open the secret, seal it for the machine, confirm with a passkey; `commit` sends it. */
async function approve(w: World, requestId: string, mode = { mode: 'once' } as Record<string, unknown>, options: { who?: Caller, signer?: ReturnType<typeof createTestAuthenticator>, before?: () => Promise<unknown>, signature?: string } = {}) {
  const who = options.who ?? w.me
  const opts = await call<ApprovalOptions>(approvalOptions, who, mode, 'POST', { id: requestId })
  const d = opts.descriptor
  const value = await openSecret(w.vault.vmk, opts.sealed!, { vaultId: w.vault.id, secretId: d.secretId, version: d.version })
  const context = { vaultId: w.vault.id, approvalId: opts.approvalId, consumerKeyFingerprint: d.consumerKeyFingerprint, secretId: d.secretId, version: d.version }
  const pkg = await sealDelivery(opts.consumer.publicKeyJwk, value, context)
  // A vault without a signing key gets one now, wrapped under the VMK this approval unlocked.
  const signingKey = opts.signing ? undefined : await createSigningKey(w.vault.vmk, w.vault.id)
  const signature = await signDelivery(await openSigningKey(w.vault.vmk, opts.signing ?? signingKey!, w.vault.id), pkg, context)
  await options.before?.()
  const assertion = w.vault.passkey.createAuthenticationResponse({ challenge: opts.assertion.challenge, origin: ORIGIN, rpId: RP_ID, counter: ++signCount, signingKey: options.signer?.privateKey })
  const body = { challengeId: opts.challengeId, assertion, package: pkg, signature: options.signature ?? signature, signingKey }
  return { opts, body, commit: () => call<{ id: string, status: string, mode: string }>(approvalCommit, who, body, 'POST', { id: requestId }) }
}

beforeEach(async () => {
  for (const table of ['secret_approvals', 'secret_access_requests', 'consumers', ...VAULT_TABLE_NAMES]) await useDb().run(`DELETE FROM ${table}` as never)
})

describe('asking for a secret', () => {
  it('pins the current version and the machine key, and waits for the owner', async () => {
    const w = await world()
    await saveSecret(w, 'TELEGRAM_BOT_TOKEN', 'tg-123')
    const req = await asAgent<RequestView & { approve_url: string }>(createRequest, { consumerId: w.machine.id, secret: 'TELEGRAM_BOT_TOKEN', purpose: 'Morning summary' })
    expect(req).toMatchObject({ status: 'pending_approval', field_name: 'TELEGRAM_BOT_TOKEN' })
    expect(req.approve_url).toBe(`${ORIGIN}/approve/${req.id}`)

    const inbox = await call<OwnerRequest[]>(listRequests, w.me, undefined, 'GET')
    expect(inbox).toHaveLength(1)
    expect(inbox[0]!.secret).toMatchObject({ alias: 'TELEGRAM_BOT_TOKEN', version: 1 })
    expect(inbox[0]!.consumer.fingerprint).toBe(await keyFingerprint(w.machine.publicJwk))
  })

  it('answers an unknown name exactly like a known one', async () => {
    const w = await world()
    await saveSecret(w, 'KNOWN', 'x')
    const known = await asAgent<Record<string, unknown>>(createRequest, { consumerId: w.machine.id, secret: 'KNOWN' })
    const unknown = await asAgent<Record<string, unknown>>(createRequest, { consumerId: w.machine.id, secret: 'UNKNOWN' })
    expect(Object.keys(unknown).sort()).toEqual(Object.keys(known).sort())
    expect(unknown.status).toBe(known.status)
  })

  it('is refused for a machine the agent may not ask for', async () => {
    const w = await world()
    const stranger = { email: 'stranger@agents.example', act: 'agent' }
    expect(await status(asAgent(createRequest, { consumerId: w.machine.id, secret: 'X' }, 'POST', {}, stranger))).toBe(404)
  })
})

describe('approving a handover', () => {
  async function pending() {
    const w = await world()
    const { secret_id } = await saveSecret(w, 'TELEGRAM_BOT_TOKEN', 'tg-123')
    const req = await asAgent<RequestView>(createRequest, { consumerId: w.machine.id, secret: 'TELEGRAM_BOT_TOKEN' })
    return { w, req, secretId: secret_id }
  }

  it('stores a package only the machine can open, and nothing in clear', async () => {
    const { w, req } = await pending()
    const { opts, commit } = await approve(w, req.id)
    expect(await commit()).toMatchObject({ status: 'active', mode: 'once' })

    const [approval] = await call<Array<{ id: string, status: string }>>(listApprovals, w.me, undefined, 'GET')
    expect(approval).toMatchObject({ id: opts.approvalId, status: 'active' })
    const row = (await useDb().run('SELECT * FROM secret_approvals' as never)) as unknown as { rows: Array<Record<string, string>> }
    const stored = row.rows[0]!
    expect(JSON.stringify(stored)).not.toContain('tg-123')
    const d = opts.descriptor
    expect(await openDelivery(w.machine.privateJwk, { epk: stored.package_epk!, iv: stored.package_iv!, ct: stored.package_ct! }, { approvalId: opts.approvalId, consumerKeyFingerprint: d.consumerKeyFingerprint, secretId: d.secretId, version: d.version })).toBe('tg-123')
    expect(await asAgent<RequestView>(readRequest, undefined, 'GET', { id: req.id })).toMatchObject({ status: 'approved' })
  })

  it('needs a fresh assertion from one of the vault\'s passkeys', async () => {
    const { w, req } = await pending()
    const { commit } = await approve(w, req.id, { mode: 'once' }, { signer: createTestAuthenticator() })
    expect(await status(commit())).toBe(400)
    expect(await asAgent<RequestView>(readRequest, undefined, 'GET', { id: req.id })).toMatchObject({ status: 'pending_approval' })
  })

  it('cannot be done with an agent token', async () => {
    const { req } = await pending()
    expect(await status(asAgent(approvalOptions, { mode: 'once' }, 'POST', { id: req.id }, { email: 'owner@x', act: 'human' }))).toBe(401)
  })

  it('cannot be done from a foreign origin', async () => {
    const { w, req } = await pending()
    expect(await status(call(approvalOptions, { ...w.me, origin: 'https://evil.test' }, { mode: 'once' }, 'POST', { id: req.id }))).toBe(403)
  })

  it('accepts a confirmation once', async () => {
    const { w, req } = await pending()
    const { body, commit } = await approve(w, req.id)
    await commit()
    expect(await status(call(approvalCommit, w.me, body, 'POST', { id: req.id }))).toBe(400)
  })

  it('cannot move a confirmation to another request', async () => {
    const { w, req } = await pending()
    const other = await asAgent<RequestView>(createRequest, { consumerId: w.machine.id, secret: 'TELEGRAM_BOT_TOKEN' })
    const { body } = await approve(w, req.id)
    expect(await status(call(approvalCommit, w.me, body, 'POST', { id: other.id }))).toBe(400)
  })

  it('is refused when the secret changed after the owner looked at it', async () => {
    const { w, req, secretId } = await pending()
    const { commit } = await approve(w, req.id, { mode: 'once' }, { before: () => saveSecret(w, 'TELEGRAM_BOT_TOKEN', 'tg-456', secretId) })
    expect(await status(commit())).toBe(409)
  })

  it('is refused for another owner\'s request', async () => {
    const { req } = await pending()
    const stranger = await world()
    expect(await status(call(approvalOptions, stranger.me, { mode: 'once' }, 'POST', { id: req.id }))).toBe(404)
  })

  it('rejects an unknown mode or a duration beyond seven days', async () => {
    const { w, req } = await pending()
    expect(await status(call(approvalOptions, w.me, { mode: 'forever' }, 'POST', { id: req.id }))).toBe(400)
    expect(await status(call(approvalOptions, w.me, { mode: 'timed', durationSec: 8 * 86400 }, 'POST', { id: req.id }))).toBe(400)
  })

  it('fixes the exact end of a timed approval before the passkey is asked', async () => {
    const { w, req } = await pending()
    const before = Math.floor(Date.now() / 1000)
    const { opts, commit } = await approve(w, req.id, { mode: 'timed', durationSec: 900 })
    await commit()
    expect(opts.descriptor.expiresAt! - before).toBeGreaterThanOrEqual(900)
    expect(opts.descriptor.expiresAt! - before).toBeLessThan(905)
  })
})

describe('saying no and taking back', () => {
  it('a denied request cannot be approved anymore', async () => {
    const w = await world()
    await saveSecret(w, 'A', 'x')
    const req = await asAgent<RequestView>(createRequest, { consumerId: w.machine.id, secret: 'A' })
    await call(denyRequest, w.me, undefined, 'POST', { id: req.id })
    expect(await asAgent<RequestView>(readRequest, undefined, 'GET', { id: req.id })).toMatchObject({ status: 'denied' })
    expect(await status(call(approvalOptions, w.me, { mode: 'once' }, 'POST', { id: req.id }))).toBe(409)
  })

  it('revoking ends an approval', async () => {
    const w = await world()
    await saveSecret(w, 'A', 'x')
    const req = await asAgent<RequestView>(createRequest, { consumerId: w.machine.id, secret: 'A' })
    const { opts, commit } = await approve(w, req.id, { mode: 'standing' })
    await commit()
    await call(revokeApproval, w.me, undefined, 'POST', { id: opts.approvalId })
    expect(await call<Array<{ status: string }>>(listApprovals, w.me, undefined, 'GET')).toMatchObject([{ status: 'revoked' }])
  })
})

describe('the owner\'s notification', () => {
  it('names who asks and never carries the requester\'s own text', async () => {
    const { formatApprovalMessage } = await import('../server/utils/vault-requests')
    const row = { fieldName: 'TELEGRAM_BOT_TOKEN', requester: 'bot@agents.example', requesterAct: 'agent', purpose: 'Urgent! Log in at evil.example/login now' }
    const text = formatApprovalMessage(row, 'Mac mini', 'https://secrets.test/approve/r1')
    expect(text).toContain('Asked by bot@agents.example (agent)')
    expect(text).not.toContain('evil')
    expect(text).not.toContain('Urgent')
    expect(text.trim().split('\n').at(-1)).toBe('https://secrets.test/approve/r1')
  })
})

describe('package signatures', () => {
  it('an approval with a signature that does not match the package is refused', async () => {
    const w = await world()
    await saveSecret(w, 'A', 'x')
    const req = await asAgent<RequestView>(createRequest, { consumerId: w.machine.id, secret: 'A' })
    const { commit } = await approve(w, req.id, { mode: 'once' }, { signature: 'A'.repeat(86) })
    expect(await status(commit())).toBe(400)
  })
})

describe('collecting', () => {
  interface Collected {
    approval_id: string
    vault_id: string
    consumer_key_fingerprint: string
    secret: { id: string, version: number }
    package: { epk: string, iv: string, ct: string }
    signature: string
    vault_signing_key: JsonWebKey
  }

  async function approved(mode: Record<string, unknown> = { mode: 'once' }) {
    const w = await world()
    const { secret_id } = await saveSecret(w, 'TELEGRAM_BOT_TOKEN', 'tg-123')
    const req = await asAgent<RequestView>(createRequest, { consumerId: w.machine.id, secret: 'TELEGRAM_BOT_TOKEN' })
    const { opts, commit } = await approve(w, req.id, mode)
    await commit()
    return { w, approvalId: opts.approvalId, secretId: secret_id }
  }

  const collect = (approvalId: string, agent = AGENT) => asAgent<Collected>(collectApproval, undefined, 'POST', { id: approvalId }, agent)

  /** What the machine does: check the vault signature, then open with its own key. */
  async function machineOpens(w: World, c: Collected) {
    const context = { vaultId: c.vault_id, approvalId: c.approval_id, consumerKeyFingerprint: c.consumer_key_fingerprint, secretId: c.secret.id, version: c.secret.version }
    expect(await verifyDelivery(c.vault_signing_key, c.package, context, c.signature)).toBe(true)
    return openDelivery(w.machine.privateJwk, c.package, context)
  }

  it('hands a once approval to the requester exactly one time, then forgets the package', async () => {
    const { w, approvalId } = await approved()
    expect(await machineOpens(w, await collect(approvalId))).toBe('tg-123')
    expect(await status(collect(approvalId))).toBe(410)
    const row = await useDb().select().from(secretApprovals).where(eq(secretApprovals.id, approvalId)).get()
    expect(row).toMatchObject({ status: 'consumed', packageCt: '' })
  })

  it('gives at most one of two simultaneous once collections a package', async () => {
    const { approvalId } = await approved()
    const results = await Promise.all([status(collect(approvalId)), status(collect(approvalId)), status(collect(approvalId))])
    expect(results.filter(r => r === 200)).toHaveLength(1)
  })

  it('refuses anyone but the identity that asked', async () => {
    const { w, approvalId } = await approved()
    expect(await status(collect(approvalId, { email: 'other@agents.example', act: 'agent' }))).toBe(404)
    expect(await status(collect(approvalId, { email: w.me.email, act: 'human' }))).toBe(404)
  })

  it('lets a timed approval collect repeatedly, and not at or after its end', async () => {
    const { w, approvalId } = await approved({ mode: 'timed', durationSec: 900 })
    await collect(approvalId)
    await collect(approvalId)
    await useDb().update(secretApprovals).set({ expiresAt: Math.floor(Date.now() / 1000) }).where(eq(secretApprovals.id, approvalId))
    expect(await status(collect(approvalId))).toBe(410)
    expect(await call<Array<{ status: string, collect_count: number }>>(listApprovals, w.me, undefined, 'GET')).toMatchObject([{ status: 'expired', collect_count: 2 }])
  })

  it('stops a standing approval when the secret gets a new version', async () => {
    const { w, approvalId, secretId } = await approved({ mode: 'standing' })
    await collect(approvalId)
    await saveSecret(w, 'TELEGRAM_BOT_TOKEN', 'tg-456', secretId)
    expect(await status(collect(approvalId))).toBe(409)
  })

  it('stops after revoking', async () => {
    const { w, approvalId } = await approved({ mode: 'standing' })
    await call(revokeApproval, w.me, undefined, 'POST', { id: approvalId })
    expect(await status(collect(approvalId))).toBe(410)
  })

  it('stops when the machine key changed', async () => {
    const { w, approvalId } = await approved({ mode: 'standing' })
    const pair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])
    const { kty, crv, x, y } = await crypto.subtle.exportKey('jwk', pair.publicKey)
    await useDb().update(consumers).set({ publicKeyJwk: JSON.stringify({ kty, crv, x, y }) }).where(eq(consumers.id, w.machine.id))
    expect(await status(collect(approvalId))).toBe(409)
  })

  it('tells the requester which machine an approval is for, before anything is collected', async () => {
    const { w, approvalId } = await approved()
    const meta = await asAgent<Record<string, unknown>>(readApproval, undefined, 'GET', { id: approvalId })
    expect(meta).toMatchObject({ id: approvalId, status: 'active', mode: 'once', consumer_id: w.machine.id, consumer_key_fingerprint: await keyFingerprint(w.machine.publicJwk) })
    expect(JSON.stringify(meta)).not.toMatch(/package|signature|epk/)
    expect(await status(asAgent(readApproval, undefined, 'GET', { id: approvalId }, { email: 'other@agents.example', act: 'agent' }))).toBe(404)
    expect(await asAgent<{ status: string }>(readApproval, undefined, 'GET', { id: approvalId })).toMatchObject({ status: 'active' })
  })

  it('records refused collections in the audit log', async () => {
    const { approvalId } = await approved()
    await status(collect(approvalId, { email: 'other@agents.example', act: 'agent' }))
    const audit = (await useDb().run('SELECT event, result FROM secret_audit_events' as never)) as unknown as { rows: Array<{ event: string, result: string }> }
    expect(audit.rows).toContainEqual({ event: 'approval.collect', result: 'refused' })
  })

  it('removes packages that can no longer be collected', async () => {
    // Revoked before revoking emptied packages itself (rows from before this change).
    const { approvalId } = await approved({ mode: 'standing' })
    await useDb().update(secretApprovals).set({ status: 'revoked' }).where(eq(secretApprovals.id, approvalId))
    const timed = await approved({ mode: 'timed', durationSec: 900 })
    await useDb().update(secretApprovals).set({ expiresAt: Math.floor(Date.now() / 1000) - 1 }).where(eq(secretApprovals.id, timed.approvalId))
    await sweepApprovalPackages()
    const rows = await useDb().select({ ct: secretApprovals.packageCt }).from(secretApprovals).all()
    expect(rows.every(r => r.ct === '')).toBe(true)
  })

  it('creates a missing vault signing key during the next approval', async () => {
    const w = await world()
    await useDb().update(vaults).set({ signingPublicJwk: null, signingKeyIv: null, signingKeyCt: null }).where(eq(vaults.id, w.vault.id))
    await saveSecret(w, 'A', 'x')
    const req = await asAgent<RequestView>(createRequest, { consumerId: w.machine.id, secret: 'A' })
    const { opts, commit } = await approve(w, req.id)
    expect(opts.signing).toBeNull()
    await commit()
    const vault = await useDb().select().from(vaults).where(eq(vaults.id, w.vault.id)).get()
    expect(vault?.signingPublicJwk).toBeTruthy()
    const c = await collect(opts.approvalId)
    expect(c.vault_signing_key).toEqual(JSON.parse(vault!.signingPublicJwk!))
    expect(await machineOpens(w, c)).toBe('x')
  })
})

describe('limits', () => {
  it('slows down a caller that asks too often', async () => {
    const w = await world()
    const noisy = { email: 'noisy@agents.example', act: 'agent' }
    const results: number[] = []
    for (let i = 0; i < 61; i++) results.push(await status(asAgent(createRequest, { consumerId: w.machine.id, secret: 'X' }, 'POST', {}, noisy)))
    expect(results.slice(0, 60).every(r => r === 404)).toBe(true)
    expect(results[60]).toBe(429)
  })
})
