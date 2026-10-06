import { randomBytes, randomUUID } from 'node:crypto'
import { createAuthorizationURL, discoverIdP } from '@openape/auth'
import { validateAssertion } from '@openape/core'
import type { AuthFlowState } from '@openape/core'
import { decodeProtectedHeader, importJWK } from 'jose'
import type { JWK } from 'jose'
import { base64url, object, parseKeys, parseOwner, ProtocolError, text, uuid } from '@openape/pods-protocol'
import type { DeviceKeys, Owner } from '@openape/pods-protocol'
import { proofBytes, sha256, verifyBytes } from '@openape/pods-protocol/crypto'
import type { RelayStore } from './store'
import { publicJson } from './public-json'

interface Flow {
  deviceId: string
  kind: 'mobile' | 'runtime'
  keys: DeviceKeys
  challenge: string
  email: string
  browserHash?: string
  flow?: AuthFlowState
  owner?: Owner
}
export class RelayAuth {
  constructor(private readonly store: RelayStore, private readonly origin: string, private readonly fixtureIdp = '', private readonly ownerAllowed: (owner: Owner) => boolean = () => false) {
    if (new URL(origin).protocol !== 'https:' && !(fixtureIdp && new URL(origin).hostname === '127.0.0.1')) throw new Error('Relay origin requires HTTPS')
  }

  begin(value: unknown) {
    const item = object(value, ['deviceId', 'kind', 'keys', 'challenge', 'email'])
    if (item.kind !== 'mobile' && item.kind !== 'runtime') throw new ProtocolError('invalid_device_kind')
    const email = text(item.email, 320)
    if (!/^[^@\s]+@[^@\s]+$/.test(email)) throw new ProtocolError('invalid_email')
    const flow: Flow = { deviceId: uuid(item.deviceId), kind: item.kind, keys: parseKeys(item.keys), challenge: base64url(item.challenge, 32), email }
    if (Number(this.store.db.prepare('SELECT count(*) AS count FROM auth_flows WHERE expires>?').get(this.store.now())?.count) >= 1000) throw new ProtocolError('login_capacity', 503)
    const id = randomUUID()
    this.store.db.prepare('INSERT INTO auth_flows VALUES(?,NULL,?,?,NULL)').run(id, JSON.stringify(flow), this.store.now() + 300000)
    return { id, browserUrl: `${this.origin}/mobile-auth/start?id=${id}` }
  }

  private read(id: string): Flow {
    const row = this.store.db.prepare('SELECT body FROM auth_flows WHERE id=? AND expires>?').get(uuid(id), this.store.now())
    if (!row) throw new ProtocolError('login_expired', 410)
    return JSON.parse(row.body as string)
  }

  async start(id: string) {
    const transaction = this.read(id)
    if (transaction.flow) throw new ProtocolError('login_already_started', 409)
    const config = this.fixtureIdp ? { idpUrl: this.fixtureIdp, record: { version: 'ddisa1', idp: this.fixtureIdp, raw: '' } } : await discoverIdP(transaction.email)
    if (!config) throw new ProtocolError('identity_provider_not_found', 404)
    await publicJson(new URL('/.well-known/jwks.json', config.idpUrl), undefined, !!this.fixtureIdp)
    const auth = await createAuthorizationURL(config, { clientId: new URL(this.origin).host, redirectUri: `${this.origin}/mobile-auth/callback`, email: transaction.email })
    const browserSecret = randomBytes(32).toString('base64url')
    transaction.flow = auth.flowState; transaction.browserHash = sha256(browserSecret)
    this.store.db.prepare('UPDATE auth_flows SET state=?,body=? WHERE id=?').run(auth.flowState.state, JSON.stringify(transaction), id)
    return { url: auth.url, browserSecret }
  }

  async callback(state: string, code: string, browserSecret: string) {
    const row = this.store.db.prepare('SELECT id FROM auth_flows WHERE state=? AND expires>?').get(state, this.store.now())
    if (!row) throw new ProtocolError('login_expired', 410)
    const id = row.id as string; const transaction = this.read(id)
    const flow = transaction.flow
    if (!flow || sha256(browserSecret) !== transaction.browserHash || flow.state !== state || transaction.owner) throw new ProtocolError('invalid_login_state', 401)
    this.store.db.prepare('UPDATE auth_flows SET state=NULL WHERE id=?').run(id)
    const result = await publicJson(new URL('/token', flow.idpUrl), { grant_type: 'authorization_code', code, code_verifier: flow.codeVerifier, redirect_uri: `${this.origin}/mobile-auth/callback`, client_id: new URL(this.origin).host }, !!this.fixtureIdp) as { assertion?: unknown }
    const assertion = text(result.assertion, 16000)
    const header = decodeProtectedHeader(assertion)
    if (!['EdDSA', 'ES256', 'RS256'].includes(String(header.alg))) throw new ProtocolError('invalid_assertion', 401)
    const jwks = await publicJson(new URL('/.well-known/jwks.json', flow.idpUrl), undefined, !!this.fixtureIdp) as { keys?: JWK[] }
    const matching = jwks.keys?.filter(key => key.kid === header.kid && (!key.alg || key.alg === header.alg) && (!key.use || key.use === 'sig'))
    if (matching?.length !== 1) throw new ProtocolError('invalid_assertion', 401)
    const publicKey = await importJWK(matching[0]!, header.alg)
    const verified = await validateAssertion(assertion, { publicKey, expectedIss: flow.idpUrl, expectedAud: new URL(this.origin).host, expectedNonce: flow.nonce })
    const claims = verified.claims
    if (!verified.valid || !claims || claims.act !== 'human' || claims.delegate || claims.delegation_grant || !Number.isSafeInteger(claims.iat) || !Number.isSafeInteger(claims.exp) || claims.iat > Math.floor(this.store.now() / 1000) + 30 || claims.exp <= claims.iat) throw new ProtocolError('direct_human_required', 403)
    transaction.owner = parseOwner({ issuer: claims.iss, subject: claims.sub })
    if (!this.ownerAllowed(transaction.owner)) throw new ProtocolError('enrollment_closed', 403)
    delete transaction.flow; delete transaction.browserHash
    const handoff = randomBytes(32).toString('base64url')
    this.store.db.prepare('UPDATE auth_flows SET body=?,code_hash=?,expires=? WHERE id=?').run(JSON.stringify(transaction), sha256(handoff), this.store.now() + 60000, id)
    return { id, code: handoff, kind: transaction.kind }
  }

  exchange(value: unknown) {
    const item = object(value, ['id', 'code', 'verifier', 'signature'])
    const id = uuid(item.id); const flow = this.read(id)
    this.store.verifyPkce(text(item.verifier, 128), flow.challenge)
    if (!verifyBytes(proofBytes('session-exchange', id, flow.challenge), text(item.signature, 128), flow.keys.signing)) throw new ProtocolError('invalid_device_proof', 401)
    if (!flow.owner) throw new ProtocolError('login_pending', 409)
    const row = this.store.db.prepare('SELECT code_hash FROM auth_flows WHERE id=?').get(id)!
    if (flow.kind === 'mobile' && sha256(text(item.code, 128)) !== row.code_hash) throw new ProtocolError('invalid_handoff', 401)
    return this.store.transaction(() => {
      const registration = this.store.register(flow.deviceId, flow.owner!, flow.kind, flow.keys)
      this.store.db.prepare('DELETE FROM auth_flows WHERE id=?').run(id)
      return this.store.issue(registration.id)
    })
  }
}
