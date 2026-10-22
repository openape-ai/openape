import type { RPConfig } from '@openape/auth'
import type { DeliveryContext, Envelope, SecretPayload, WrappedKey } from '@openape/ape-secrets/vault'
import type { Action, Approval, Challenge, Consumer, Credential, Principal, Request, Secret, Vault } from './types'
import { createHash, createPublicKey, randomBytes, randomUUID, webcrypto } from 'node:crypto'
import { createAuthenticationOptions, createRegistrationOptions, verifyAuthentication, verifyRegistration } from '@openape/auth'
import type { Records, VaultStore } from './store'

export class VaultError extends Error {
  constructor(readonly status: number, message: string) { super(message) }
}
function fail(status: number, message: string): never { throw new VaultError(status, message) }
const id = () => randomUUID()
const hash = (s: string) => createHash('sha256').update(s).digest('base64url')
type Input = Record<string, unknown>
function object(input: unknown): Input {
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail(400, 'Object required')
  return input as Input
}
function fields(input: Input, allowed: string[]) {
  if (Object.keys(input).some(key => !allowed.includes(key))) fail(400, 'Unknown field')
}
function text(input: unknown, max = 200): string {
  if (typeof input !== 'string' || !input.trim() || input.length > max) fail(400, 'Invalid text')
  return input as string
}
function binary(input: unknown, length?: number): string {
  const value = text(input, 100000)
  if (!/^[\w-]+$/.test(value) || (length !== undefined && Buffer.from(value, 'base64url').length !== length)) fail(400, 'Invalid binary field')
  return value
}
function box(input: unknown) {
  const v = object(input); fields(v, ['iv', 'ct'])
  const ct = binary(v.ct)
  if (Buffer.from(ct, 'base64url').length < 16 || ct.length > 45000) fail(400, 'Invalid encrypted payload size')
  return { iv: binary(v.iv, 12), ct }
}
function wrapper(input: unknown): WrappedKey {
  const v = object(input); fields(v, ['salt', 'box'])
  return { salt: binary(v.salt, 32), box: box(v.box) }
}
function payload(input: unknown): SecretPayload {
  const v = object(input); fields(v, ['value', 'key'])
  return { value: box(v.value), key: box(v.key) }
}
function publicKey(input: unknown) {
  const v = object(input); fields(v, ['kty', 'crv', 'x', 'y', 'ext', 'key_ops'])
  if (v.kty !== 'EC' || v.crv !== 'P-256') fail(400, 'Public P-256 key required')
  const jwk = { kty: 'EC', crv: 'P-256', x: binary(v.x, 32), y: binary(v.y, 32) }
  try { createPublicKey({ key: jwk, format: 'jwk' }) }
  catch { fail(400, 'Invalid public key') }
  return jwk
}
function keyFingerprint(jwk: JsonWebKey) { return hash(JSON.stringify({ crv: jwk.crv, kty: jwk.kty, x: jwk.x, y: jwk.y })) }
function equalDescriptor(a: unknown, b: DeliveryContext) {
  const v = object(a)
  fields(v, Object.keys(b))
  return Object.keys(b).every(k => v[k] === b[k as keyof DeliveryContext])
}
function assertion(input: unknown) {
  const v = object(input)
  fields(v, ['id', 'rawId', 'response', 'type', 'clientExtensionResults', 'authenticatorAttachment'])
  if (v.type !== 'public-key') fail(400, 'Public-key assertion required')
  // Extensions are client outputs, not proof. In particular, NEVER accept PRF results.
  if (v.clientExtensionResults && Object.keys(object(v.clientExtensionResults)).length) fail(400, 'Do not transmit extension results')
  const response = object(v.response)
  fields(response, ['clientDataJSON', 'authenticatorData', 'signature', 'userHandle', 'attestationObject', 'transports'])
  return v
}
export class VaultService {
  constructor(readonly store: VaultStore, readonly rp: RPConfig, readonly now = () => Date.now()) {}
  human(p: Principal) {
    if (p.authentication !== 'session' || p.act !== 'human' || p.actor !== p.subject || !p.session) fail(403, 'Human browser session required')
  }

  async owned<T extends { id: string, owner: string }>(db: Records, table: Parameters<Records['get']>[0], recordId: string, owner: string): Promise<T> {
    const row = await db.get<T>(table, recordId)
    if (!row || row.owner !== owner) fail(404, 'Not found')
    return row!
  }

  async audit(db: Records, p: Principal, action: string, resourceId: string) {
    await db.insert('audit', { id: id(), owner: p.subject, actor: p.actor, action, resourceId, at: this.now() })
  }

  async challenge(db: Records, p: Principal, purpose: Challenge['purpose'], challenge: string, extra: Partial<Challenge> = {}) {
    if ((await db.list<Challenge>('challenges', p.subject)).filter(c => c.expiresAt > this.now()).length >= 30) fail(429, 'Too many ceremonies; wait five minutes')
    const row: Challenge = { id: id(), owner: p.subject, session: p.session, purpose, challenge, expiresAt: this.now() + 300000, ...extra }
    await db.insert('challenges', row)
    return row.id
  }

  async pending(db: Records, p: Principal, challengeId: string, purpose: Challenge['purpose']) {
    const c = await this.owned<Challenge>(db, 'challenges', challengeId, p.subject)
    if (c.session !== p.session || c.purpose !== purpose || c.consumed || c.expiresAt <= this.now()) fail(409, 'Expired or consumed ceremony')
    return c
  }

  async consume(db: Records, c: Challenge) { await db.put('challenges', { ...c, consumed: true }) }
  async credential(db: Records, p: Principal, credentialId: string) {
    const c = await this.owned<Credential>(db, 'credentials', credentialId, p.subject)
    if (c.disabled) fail(403, 'Credential disabled')
    return c
  }

  async authenticate(db: Records, p: Principal, c: Challenge, input: unknown) {
    const response = assertion(input)
    if (response.id !== c.credentialId) fail(403, 'Credential mismatch')
    const credential = await this.credential(db, p, text(response.id, 2048))
    const verified = await verifyAuthentication(response as unknown as Parameters<typeof verifyAuthentication>[0], c.challenge, this.rp, credential.credential)
    if (!verified.verified) fail(403, 'Passkey verification failed')
    await db.put('credentials', { ...credential, credential: { ...credential.credential, counter: verified.newCounter! } })
    return credential
  }

  async view(p: Principal) {
    this.human(p)
    const vault = await this.store.get<Vault>('vaults', p.subject)
    return {
      vault,
      owner: p.subject,
      rp: this.rp.rpID,
      registeredConsumers: (await this.store.tx.execute({ sql: 'SELECT id, name, public_key_jwk, allowed_requesters FROM consumers WHERE owner_email=?', args: [p.subject] })).rows.map(r => ({ id: String(r.id), name: String(r.name), fingerprint: keyFingerprint(JSON.parse(String(r.public_key_jwk))), collectors: [p.subject, ...JSON.parse(String(r.allowed_requesters)) as string[]] })),
      credentials: (await this.store.list<Credential>('credentials', p.subject)).filter(c => !c.disabled).map(c => ({ id: c.id, input: c.input, wrapper: c.wrapper })),
      secrets: (await this.store.list<Secret>('secrets', p.subject)).filter(s => !s.deleted),
      consumers: await this.store.list<Consumer>('consumers', p.subject),
      requests: await this.store.list<Request>('requests', p.subject),
      approvals: (await this.store.list<Approval>('approvals', p.subject)).map(({ envelope: _envelope, ...a }) => a),
    }
  }

  async setupOptions(p: Principal) {
    this.human(p)
    return this.store.write(async (db) => {
      if (await db.get('vaults', p.subject)) fail(409, 'Vault already exists')
      const { options, challenge } = await createRegistrationOptions(this.rp, p.subject, p.subject)
      return { challengeId: await this.challenge(db, p, 'setup', challenge), options: { ...options, extensions: { prf: {} } } }
    })
  }

  async register(p: Principal, input: Input, purpose: 'setup' | 'enroll') {
    this.human(p); fields(input, ['challengeId', 'response'])
    return this.store.write(async (db) => {
      const c = await this.pending(db, p, text(input.challengeId), purpose)
      if (c.authorizedBy) await this.credential(db, p, c.authorizedBy)
      if (purpose === 'setup' && await db.get('vaults', p.subject)) fail(409, 'Vault already exists')
      const verified = await verifyRegistration(assertion(input.response) as unknown as Parameters<typeof verifyRegistration>[0], c.challenge, this.rp, p.subject)
      if (!verified.credential || !verified.verified || await db.get('credentials', verified.credential!.credentialId)) fail(409, 'Credential unavailable')
      await this.consume(db, c)
      const prfInput = randomBytes(32).toString('base64url')
      const { options, challenge } = await createAuthenticationOptions(this.rp, [verified.credential!])
      const challengeId = await this.challenge(db, p, purpose === 'setup' ? 'setup-confirm' : 'enroll-confirm', challenge, { authorizedBy: c.authorizedBy, provisional: verified.credential, input: prfInput, credentialId: verified.credential!.credentialId })
      return { challengeId, credentialId: verified.credential!.credentialId, input: prfInput, options }
    })
  }

  async confirm(p: Principal, input: Input, purpose: 'setup-confirm' | 'enroll-confirm') {
    this.human(p); fields(input, ['challengeId', 'response', 'wrapper', 'recovery'])
    return this.store.write(async (db) => {
      const c = await this.pending(db, p, text(input.challengeId), purpose)
      if (c.authorizedBy) await this.credential(db, p, c.authorizedBy)
      const response = assertion(input.response)
      if (response.id !== c.credentialId) fail(403, 'Credential mismatch')
      const verified = await verifyAuthentication(response as unknown as Parameters<typeof verifyAuthentication>[0], c.challenge, this.rp, c.provisional!)
      if (!verified.verified) fail(403, 'Passkey verification failed')
      const wrapped = wrapper(input.wrapper)
      if (purpose === 'setup-confirm') {
        if (await db.get('vaults', p.subject)) fail(409, 'Vault already exists')
        const r = object(input.recovery); fields(r, ['id', 'publicKey', 'wrapper', 'privateKey'])
        await db.insert<Vault>('vaults', { id: p.subject, owner: p.subject, recoveryId: text(r.id), recoveryPublicKey: publicKey(r.publicKey), recoveryWrapper: wrapper(r.wrapper), recoveryPrivateKey: wrapper(r.privateKey) })
      }
      else if (!await db.get('vaults', p.subject)) {
        fail(409, 'Vault missing')
      }
      await db.insert<Credential>('credentials', { id: c.provisional!.credentialId, owner: p.subject, credential: { ...c.provisional!, counter: verified.newCounter! }, input: c.input!, wrapper: wrapped, disabled: false })
      await this.consume(db, c)
      await this.audit(db, p, 'credential-added', c.provisional!.credentialId)
      return { ok: true }
    })
  }

  async actionOptions(p: Principal, input: Input) {
    this.human(p); fields(input, ['credentialId', 'action'])
    return this.store.write(async (db) => {
      const credential = await this.credential(db, p, text(input.credentialId, 2048))
      const v = object(input.action)
      let action: Action
      if (v.type === 'save') {
        fields(v, ['type', 'secretId', 'alias'])
        const alias = text(v.alias, 120)
        const old = v.secretId ? await this.owned<Secret>(db, 'secrets', text(v.secretId), p.subject) : null
        if (old?.deleted) fail(409, 'Secret deleted')
        if ((await db.list<Secret>('secrets', p.subject)).some(s => !s.deleted && s.alias === alias && s.id !== old?.id)) fail(409, 'Alias already exists')
        action = { type: 'save', secretId: old?.id ?? id(), alias, version: (old?.version ?? 0) + 1 }
      }
      else if (v.type === 'bind') {
        fields(v, ['type', 'consumerId', 'collector'])
        const legacy = await db.tx.execute({ sql: 'SELECT * FROM consumers WHERE id=? AND owner_email=?', args: [text(v.consumerId), p.subject] })
        const row = legacy.rows[0]
        if (!row) fail(404, 'Consumer not found')
        const collector = text(v.collector)
        const allowed = JSON.parse(String(row!.allowed_requesters)) as string[]
        if (collector !== p.subject && !allowed.includes(collector)) fail(403, 'Collector not registered for this consumer')
        action = { type: 'bind', consumerId: text(v.consumerId), collector, fingerprint: keyFingerprint(publicKey(JSON.parse(String(row!.public_key_jwk)))) }
      }
      else if (v.type === 'approve') {
        fields(v, ['type', 'requestId', 'mode', 'duration'])
        const request = await this.owned<Request>(db, 'requests', text(v.requestId), p.subject)
        if (request.status !== 'pending' || request.expiresAt <= this.now()) fail(409, 'Request is no longer pending')
        const consumer = await this.owned<Consumer>(db, 'consumers', request.consumerId, p.subject)
        if (consumer.disabled || consumer.fingerprint !== request.fingerprint || consumer.collector !== request.requester) fail(409, 'Recipient changed')
        if (request.version > 0) {
          const secret = await this.owned<Secret>(db, 'secrets', request.secretId, p.subject)
          if (secret.deleted || secret.version !== request.version) fail(409, 'Secret changed')
        }
        if (!['once', 'timed', 'standing'].includes(String(v.mode))) fail(400, 'Invalid release mode')
        const duration = v.mode === 'once' ? 86400 : v.mode === 'timed' ? Number(v.duration ?? 900) : null
        if (duration !== null && (!Number.isInteger(duration) || duration < 60 || duration > 604800)) fail(400, 'Duration must be 60–604800 seconds')
        const descriptor: DeliveryContext = { owner: p.subject, requester: request.requester, consumerId: consumer.id, fingerprint: consumer.fingerprint, secretId: request.secretId, version: request.version, approvalId: id(), mode: v.mode as DeliveryContext['mode'], expiresAt: duration === null ? null : this.now() + duration * 1000 }
        action = { type: 'approve', requestId: request.id, descriptor }
      }
      else if (v.type === 'enroll' || v.type === 'unlock') { fields(v, ['type']); action = { type: v.type } }
      else {
        fail(400, 'Unknown operation')
      }
      const { options, challenge } = await createAuthenticationOptions(this.rp, [credential.credential])
      const challengeId = await this.challenge(db, p, 'action', challenge, { action: action!, credentialId: credential.id })
      return { challengeId, action: action!, options, input: credential.input, wrapper: credential.wrapper, credentialId: credential.id }
    })
  }

  async actionCommit(p: Principal, input: Input) {
    this.human(p); fields(input, ['challengeId', 'response', 'payload', 'envelope'])
    return this.store.write(async (db) => {
      const c = await this.pending(db, p, text(input.challengeId), 'action')
      await this.authenticate(db, p, c, input.response)
      const action = c.action!
      if (action.type === 'save') {
        const old = await db.get<Secret>('secrets', action.secretId)
        if ((old?.version ?? 0) + 1 !== action.version || old?.deleted) fail(409, 'Secret changed')
        if ((await db.list<Secret>('secrets', p.subject)).some(s => !s.deleted && s.alias === action.alias && s.id !== action.secretId)) fail(409, 'Alias already exists')
        const next: Secret = { id: action.secretId, owner: p.subject, alias: action.alias, version: action.version, payload: payload(input.payload), deleted: false }
        await db.insert('versions', { ...next, id: `${action.secretId}:${action.version}`, secretId: action.secretId })
        await db.put<Secret>('secrets', next)
        for (const a of await db.list<Approval>('approvals', p.subject)) {
          if (a.descriptor.secretId === action.secretId) await db.put('approvals', { ...a, status: 'superseded', envelope: null })
        }
      }
      if (action.type === 'bind') {
        const rows = await db.tx.execute({ sql: 'SELECT * FROM consumers WHERE id=? AND owner_email=?', args: [action.consumerId, p.subject] })
        const row = rows.rows[0]
        if (!row) fail(409, 'Consumer changed')
        const key = publicKey(JSON.parse(String(row!.public_key_jwk)))
        if ((action.collector !== p.subject && !(JSON.parse(String(row!.allowed_requesters)) as string[]).includes(action.collector)) || keyFingerprint(key) !== action.fingerprint) fail(409, 'Consumer changed')
        await db.put<Consumer>('consumers', { id: action.consumerId, owner: p.subject, name: String(row!.name), collector: action.collector, fingerprint: action.fingerprint, publicKey: key, disabled: false })
        for (const a of await db.list<Approval>('approvals', p.subject)) {
          if (a.descriptor.consumerId === action.consumerId) await db.put('approvals', { ...a, status: 'superseded', envelope: null })
        }
      }
      if (action.type === 'approve') {
        const r = await this.owned<Request>(db, 'requests', action.requestId, p.subject)
        const consumer = await this.owned<Consumer>(db, 'consumers', r.consumerId, p.subject)
        if (r.status !== 'pending' || r.expiresAt <= this.now() || consumer.disabled || consumer.fingerprint !== action.descriptor.fingerprint || consumer.collector !== r.requester) fail(409, 'Request or recipient changed')
        if (r.version > 0) {
          const secret = await this.owned<Secret>(db, 'secrets', r.secretId, p.subject)
          if (secret.deleted || secret.version !== r.version) fail(409, 'Secret changed')
        }
        const e = object(input.envelope); fields(e, ['format', 'context', 'epk', 'salt', 'box'])
        if (e.format !== 'openape.secrets/2' || !equalDescriptor(e.context, action.descriptor) || (action.descriptor.expiresAt !== null && action.descriptor.expiresAt <= this.now())) fail(400, 'Envelope context mismatch or expired')
        const envelope: Envelope = { format: 'openape.secrets/2', context: action.descriptor, epk: binary(e.epk, 65), salt: binary(e.salt, 32), box: box(e.box) }
        await db.insert<Approval>('approvals', { id: action.descriptor.approvalId, owner: p.subject, credentialId: c.credentialId!, descriptor: action.descriptor, envelope, status: 'active', createdAt: this.now() })
        await db.put('requests', { ...r, status: 'approved', approvalId: action.descriptor.approvalId })
      }
      await this.consume(db, c)
      await this.audit(db, p, action.type, action.type === 'approve' ? action.descriptor.approvalId : action.type === 'save' ? action.secretId : action.type === 'bind' ? action.consumerId : c.id)
      if (action.type === 'enroll') {
        const credentials = await db.list<Credential>('credentials', p.subject)
        const { options, challenge } = await createRegistrationOptions(this.rp, p.subject, p.subject, credentials.map(v => v.credential))
        return { challengeId: await this.challenge(db, p, 'enroll', challenge, { authorizedBy: c.credentialId }), options: { ...options, extensions: { prf: {} } } }
      }
      return { ok: true, action }
    })
  }

  async request(p: Principal, input: Input) {
    fields(input, ['consumerId', 'alias', 'purpose'])
    return this.store.write(async (db) => {
      const consumer = await db.get<Consumer>('consumers', text(input.consumerId))
      if (!consumer || consumer.disabled || consumer.collector !== p.actor) fail(404, 'Recipient not available')
      if ((await db.list<Request>('requests', consumer!.owner)).filter(r => r.requester === p.actor && r.status === 'pending' && r.expiresAt > this.now()).length >= 50) fail(429, 'Too many pending requests')
      const alias = text(input.alias, 120)
      const secret = (await db.list<Secret>('secrets', consumer!.owner)).find(s => !s.deleted && s.alias === alias)
      const request: Request = { id: id(), owner: consumer!.owner, requester: p.actor, consumerId: consumer!.id, fingerprint: consumer!.fingerprint, secretId: secret?.id ?? `new:${alias}`, version: secret?.version ?? 0, purpose: input.purpose ? text(input.purpose, 500) : '', status: 'pending', expiresAt: this.now() + 86400000 }
      const approval = (await db.list<Approval>('approvals', consumer!.owner)).find(a => this.available(a) && a.descriptor.consumerId === consumer!.id && a.descriptor.fingerprint === consumer!.fingerprint && a.descriptor.requester === p.actor && a.descriptor.secretId === request.secretId && a.descriptor.version === request.version)
      if (approval) { request.status = 'approved'; request.approvalId = approval.id }
      await db.insert('requests', request)
      return { id: request.id, status: approval ? 'ready' : 'pending_approval', approvalId: approval?.id }
    })
  }

  available(a: Approval) { return a.status === 'active' && a.envelope !== null && (a.descriptor.expiresAt === null || a.descriptor.expiresAt > this.now()) }
  async status(p: Principal, requestId: string) {
    const r = await this.store.get<Request>('requests', requestId)
    if (!r || (r.requester !== p.actor && !(p.act === 'human' && p.actor === r.owner))) fail(404, 'Request not found')
    const a = r!.approvalId ? await this.store.get<Approval>('approvals', r!.approvalId) : null
    return { id: r!.id, consumerId: r!.consumerId, approvalId: a?.id, descriptor: a?.descriptor, status: a ? (this.available(a) ? 'ready' : a.status === 'active' ? 'expired' : a.status) : r!.status === 'pending' ? (r!.expiresAt <= this.now() ? 'expired' : 'pending_approval') : r!.status }
  }

  async collect(p: Principal, approvalId: string, consumerId: string) {
    return this.store.write(async (db) => {
      const a = await db.get<Approval>('approvals', approvalId)
      if (!a || a.descriptor.requester !== p.actor || a.descriptor.consumerId !== consumerId) fail(404, 'Approval not found')
      const consumer = await this.owned<Consumer>(db, 'consumers', consumerId, a!.owner)
      if (consumer.disabled || consumer.collector !== p.actor || consumer.fingerprint !== a!.descriptor.fingerprint) fail(403, 'Recipient changed')
      if (!this.available(a!)) fail(410, 'Approval is no longer available')
      if (a!.descriptor.version > 0) {
        const secret = await this.owned<Secret>(db, 'secrets', a!.descriptor.secretId, a!.owner)
        if (secret.deleted || secret.version !== a!.descriptor.version) fail(410, 'Secret changed')
      }
      const envelope = a!.envelope!
      if (a!.descriptor.mode === 'once') await db.put('approvals', { ...a!, status: 'consumed', envelope: null, consumedAt: this.now() })
      await this.audit(db, { ...p, subject: a!.owner }, 'collected', a!.id)
      return { envelope, descriptor: a!.descriptor }
    })
  }

  async revoke(p: Principal, approvalId: string) {
    this.human(p)
    return this.store.write(async (db) => {
      const a = await this.owned<Approval>(db, 'approvals', approvalId, p.subject)
      await db.put('approvals', { ...a, status: 'revoked', envelope: null })
      await this.audit(db, p, 'revoked', a.id)
      return { ok: true }
    })
  }

  async remove(p: Principal, table: 'secrets' | 'credentials' | 'consumers', recordId: string) {
    this.human(p)
    return this.store.write(async (db) => {
      const r = await this.owned<Secret | Credential | Consumer>(db, table, recordId, p.subject)
      if (table === 'credentials' && (await db.list<Credential>('credentials', p.subject)).filter(c => !c.disabled).length < 2) fail(409, 'Add a replacement passkey first')
      await db.put(table, { ...r, ...(table === 'secrets' ? { deleted: true } : { disabled: true }) })
      if (table !== 'credentials') {
        for (const a of await db.list<Approval>('approvals', p.subject)) {
          if (table === 'secrets' ? a.descriptor.secretId === recordId : a.descriptor.consumerId === recordId) await db.put('approvals', { ...a, status: 'revoked', envelope: null })
        }
      }
      await this.audit(db, p, `${table}-disabled`, recordId)
      return { ok: true }
    })
  }

  async deny(p: Principal, requestId: string) {
    this.human(p)
    return this.store.write(async (db) => {
      const r = await this.owned<Request>(db, 'requests', requestId, p.subject)
      if (r.status !== 'pending') fail(409, 'Request not pending')
      await db.put('requests', { ...r, status: 'denied' })
      await this.audit(db, p, 'denied', r.id)
      return { ok: true }
    })
  }

  async cancel(p: Principal, requestId: string) {
    return this.store.write(async (db) => {
      const r = await db.get<Request>('requests', requestId)
      if (!r || r.requester !== p.actor) fail(404, 'Request not found')
      if (r!.status !== 'pending') fail(409, 'Request is no longer pending')
      await db.put('requests', { ...r!, status: 'cancelled' })
      await this.audit(db, { ...p, subject: r!.owner }, 'cancelled', r!.id)
      return { ok: true }
    })
  }

  async recoveryOptions(p: Principal) {
    this.human(p)
    return this.store.write(async (db) => {
      const vault = await this.owned<Vault>(db, 'vaults', p.subject, p.subject)
      const challenge = randomBytes(32).toString('base64url')
      return { vault, challenge, challengeId: await this.challenge(db, p, 'recovery', challenge) }
    })
  }

  async recoveryCommit(p: Principal, input: Input) {
    this.human(p); fields(input, ['challengeId', 'signature'])
    return this.store.write(async (db) => {
      const c = await this.pending(db, p, text(input.challengeId), 'recovery')
      const vault = await this.owned<Vault>(db, 'vaults', p.subject, p.subject)
      const key = await webcrypto.subtle.importKey('jwk', vault.recoveryPublicKey, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify'])
      const verified = await webcrypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, Buffer.from(binary(input.signature, 64), 'base64url'), Buffer.from(JSON.stringify(['openape.recovery/2', p.subject, c.id, c.challenge])))
      if (!verified) fail(403, 'Recovery proof failed')
      await this.consume(db, c)
      const credentials = await db.list<Credential>('credentials', p.subject)
      const { options, challenge } = await createRegistrationOptions(this.rp, p.subject, p.subject, credentials.map(v => v.credential))
      await this.audit(db, p, 'recovery-proven', c.id)
      return { challengeId: await this.challenge(db, p, 'enroll', challenge), options: { ...options, extensions: { prf: {} } } }
    })
  }
}
