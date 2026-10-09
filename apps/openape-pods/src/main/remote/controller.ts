import type { InboxPublication } from '../../worker/inbox/outbox'
import type { InboxDecision } from '../../contracts/inbox'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { safeStorage, shell } from 'electron'
import { object, parseOwner, sameOwner, text, uuid } from '@openape/pods-protocol'
import type { DeviceKeys, Owner } from '@openape/pods-protocol'
import { challenge, generateKey, proofBytes, publicKey, sha256, signBytes } from '@openape/pods-protocol/crypto'
import type { FixtureWorker } from '../worker'
import type { RemoteRegistration } from '../../worker/remote/registration'

interface Tokens { accessToken: string, refreshToken: string, expiresAt: string, registration: RemoteRegistration }
interface Saved { id: string, signing: string, agreement: string, enabled: boolean, tokens?: Tokens }
// 15 s for the round trip plus one second per 32 KiB, so large uploads on a slow uplink finish.
export function requestTimeout(bytes: number): number { return Math.min(30 * 60000, 15000 + Math.ceil(bytes / 32768) * 1000) }
export class RemoteServiceError extends Error {
  constructor(readonly status: number, readonly code: string | null = null) { super(`Remote service returned ${status}${code ? `: ${code}` : ''}`) }
}
export class RemoteController {
  private saved: Saved | null = null
  private refreshing: Promise<void> | null = null
  private stopping = false
  private abort = new AbortController()
  private delivering = false
  private decisions: { digest: string, at: number } | null = null
  private publishingDecisions = false
  constructor(private readonly root: string, private readonly worker: FixtureWorker, private readonly origin = 'https://pods.openape.ai') {
    const url = new URL(origin)
    if (url.protocol !== 'https:' || url.origin !== origin) throw new Error('Remote service must be an HTTPS origin')
  }

  private keys(): DeviceKeys { return { signing: publicKey(this.saved!.signing), agreement: publicKey(this.saved!.agreement) } }
  private async load(): Promise<void> {
    if (this.saved) return
    if (!safeStorage.isEncryptionAvailable()) throw new Error('Unlock the macOS keychain before registering this desktop')
    try { this.saved = JSON.parse(safeStorage.decryptString(await readFile(join(this.root, 'remote/registration.enc')))) as Saved }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      this.saved = { id: randomUUID(), signing: generateKey(), agreement: generateKey(), enabled: false }
    }
  }

  private async save(): Promise<void> {
    const folder = join(this.root, 'remote'); await mkdir(folder, { recursive: true, mode: 0o700 })
    await writeFile(join(folder, 'registration.pending'), safeStorage.encryptString(JSON.stringify(this.saved)), { mode: 0o600 })
    await rename(join(folder, 'registration.pending'), join(folder, 'registration.enc'))
  }

  private async serviceError(response: Response): Promise<RemoteServiceError> {
    const body = await response.text()
    let problem: unknown
    try { problem = JSON.parse(body) }
    catch { return new RemoteServiceError(response.status, 'invalid_error_response') }
    const code = problem && typeof problem === 'object' && 'code' in problem ? problem.code : null
    return new RemoteServiceError(response.status, typeof code === 'string' ? code.slice(0, 80) : null)
  }

  private registration(value: unknown, owner: Owner, expected?: RemoteRegistration): RemoteRegistration {
    const row = object(value, ['id', 'generation', 'owner', 'kind', 'keys', 'epoch', 'revoked'])
    const registration = { id: uuid(row.id), generation: uuid(row.generation), owner: parseOwner(row.owner) }
    if (registration.id !== this.saved!.id || !sameOwner(registration.owner, owner)) throw new Error('Registered identity differs from the selected desktop owner')
    if (row.revoked === true) throw new Error('Desktop registration has been revoked')
    if (expected && (registration.id !== expected.id || registration.generation !== expected.generation || !sameOwner(registration.owner, expected.owner))) throw new Error('Desktop registration differs from the existing workspace; explicit recovery is required')
    return registration
  }

  private tokens(value: unknown, owner: Owner, expected?: RemoteRegistration): Tokens {
    const row = object(value, ['accessToken', 'refreshToken', 'expiresAt', 'registration'])
    const expiresAt = text(row.expiresAt, 80)
    if (!Number.isFinite(Date.parse(expiresAt))) throw new Error('Invalid desktop session expiry')
    return { accessToken: text(row.accessToken, 4096), refreshToken: text(row.refreshToken, 4096), expiresAt, registration: this.registration(row.registration, owner, expected) }
  }

  private async post(path: string, body: unknown): Promise<unknown> {
    const response = await fetch(`${this.origin}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), redirect: 'error', signal: AbortSignal.any([this.abort.signal, AbortSignal.timeout(15000)]) })
    if (!response.ok) throw await this.serviceError(response)
    return response.json()
  }

  private async signed(method: 'POST', path: string, body: unknown, waitMs = 0): Promise<unknown> {
    const token = this.saved!.tokens!.accessToken; const data = JSON.stringify(body)
    const id = randomUUID(); const at = new Date().toISOString(); const digest = sha256(data)
    const signature = signBytes(proofBytes('api-request', id, JSON.stringify([method, path, sha256(token), at, digest])), this.saved!.signing)
    const response = await fetch(`${this.origin}${path}`, { method, headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`, 'x-pods-request-id': id, 'x-pods-request-at': at, 'x-pods-body-digest': digest, 'x-pods-proof': signature }, body: data, redirect: 'error', signal: AbortSignal.any([this.abort.signal, AbortSignal.timeout(requestTimeout(Buffer.byteLength(data)) + waitMs)]) })
    if (!response.ok) throw await this.serviceError(response)
    return response.json()
  }

  async enable({ owner, email }: { owner: Owner, email: string }): Promise<void> {
    await this.load()
    const status = await this.worker.remote({ type: 'status' }) as { registration: RemoteRegistration | null }
    const previous = this.saved!.tokens?.registration
    if (previous) this.registration(previous, owner)
    if (status.registration) this.registration(status.registration, owner, previous)
    if (previous && !status.registration) throw new Error('Desktop workspace registration is missing; explicit recovery is required')
    const expected = previous ?? status.registration ?? undefined
    await this.disable()
    if (previous) {
      try {
        await this.refresh()
        const path = '/api/runtime/v1/registration'
        const id = randomUUID(); const at = new Date().toISOString(); const token = this.saved!.tokens!.accessToken
        const signature = signBytes(proofBytes('api-request', id, JSON.stringify(['GET', path, sha256(token), at, sha256('')])), this.saved!.signing)
        const response = await fetch(`${this.origin}${path}`, { headers: { authorization: `Bearer ${token}`, 'x-pods-request-id': id, 'x-pods-request-at': at, 'x-pods-body-digest': sha256(''), 'x-pods-proof': signature }, redirect: 'error', signal: AbortSignal.any([this.abort.signal, AbortSignal.timeout(15000)]) })
        if (!response.ok) throw await this.serviceError(response)
        this.registration(await response.json(), owner, expected)
        await this.connected(this.saved!.tokens!, owner)
        return
      }
      catch (error) {
        if (!(error instanceof RemoteServiceError) || error.status !== 401 || !['authentication_required', 'refresh_replay'].includes(error.code ?? '')) throw error
      }
    }
    const verifier = randomBytes(32).toString('base64url')
    const pkce = challenge(verifier)
    const begin = await this.post('/api/mobile/v1/session/begin', { deviceId: this.saved!.id, kind: 'runtime', keys: this.keys(), challenge: pkce, email }) as { id: string, browserUrl: string }
    if (!begin.browserUrl.startsWith(`${this.origin}/mobile-auth/start?`)) throw new Error('Invalid enrollment URL')
    await shell.openExternal(begin.browserUrl)
    const expires = Date.now() + 300000
    let tokens: Tokens | undefined
    while (Date.now() < expires && !this.stopping) {
      const response = await fetch(`${this.origin}/api/mobile/v1/session/exchange`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: begin.id, verifier, signature: signBytes(proofBytes('session-exchange', begin.id, pkce), this.saved!.signing) }), redirect: 'error', signal: AbortSignal.any([this.abort.signal, AbortSignal.timeout(10000)]) })
      if (!response.ok) {
        const error = await this.serviceError(response)
        if (error.status !== 409 || error.code !== 'login_pending') throw error
        await delay(1500, undefined, { signal: this.abort.signal })
        continue
      }
      tokens = this.tokens(await response.json(), owner, expected)
      break
    }
    if (!tokens) throw new Error('Desktop registration expired')
    await this.connected(tokens, owner)
  }

  private async connected(tokens: Tokens, owner: Owner): Promise<void> {
    this.saved!.tokens = tokens; this.saved!.enabled = true; await this.save()
    await this.worker.remote({ type: 'configure', registration: tokens.registration })
    await this.worker.indexRemotePods(owner)
  }

  private async refresh(): Promise<void> {
    if (!this.refreshing) this.refreshing = this.refreshTokens().finally(() => { this.refreshing = null })
    return this.refreshing
  }

  // Refusals (invalid or conflicting content) are final; every other failure retries the identical event,
  // which the inbox deduplicates, so an uncertain delivery never produces a second message.
  async deliverInbox(): Promise<void> {
    if (this.delivering) return
    this.delivering = true
    try {
      await this.load()
      if (!this.saved?.enabled || !this.saved.tokens) return
      const due = await this.worker.inboxOutbox({ type: 'due' }) as InboxPublication[]
      if (!due.length) return
      const identity = await this.worker.remoteOwner()
      if (!sameOwner(identity.owner, this.saved.tokens.registration.owner)) return
      await this.refresh()
      for (const publication of due) {
        try {
          const receipt = await this.signed('POST', '/api/runtime/v1/inbox', publication) as { id: string }
          await this.worker.inboxOutbox({ type: 'settle', eventId: publication.eventId, outcome: { state: 'delivered', itemId: receipt.id } })
        }
        catch (error) {
          const reason = error instanceof Error ? error.message : 'Delivery failed'
          const refused = error instanceof RemoteServiceError && [400, 409, 413].includes(error.status)
          await this.worker.inboxOutbox({ type: 'settle', eventId: publication.eventId, outcome: refused ? { state: 'refused', reason } : { state: 'retry', reason } })
        }
      }
    }
    finally { this.delivering = false }
  }

  /**
   * Publishes the complete decision set whenever it changes, and at least every ten minutes so a
   * restarted relay or a lost response converges. The relay resolves decisions missing from the set.
   */
  async publishDecisions(collect: () => Promise<InboxDecision[]>): Promise<void> {
    if (this.publishingDecisions) return
    this.publishingDecisions = true
    try {
      await this.load()
      if (!this.saved?.enabled || !this.saved.tokens) return
      const decisions = await collect()
      const digest = createHash('sha256').update(JSON.stringify(decisions)).digest('hex')
      if (this.decisions?.digest === digest && Date.now() - this.decisions.at < 600000) return
      const identity = await this.worker.remoteOwner()
      if (!sameOwner(identity.owner, this.saved.tokens.registration.owner)) return
      await this.refresh()
      const receipt = await this.signed('POST', '/api/runtime/v1/inbox/decisions', { decisions }) as { skipped?: number }
      if (receipt.skipped) console.error(`The account inbox is full; ${receipt.skipped} new decisions were not added`)
      this.decisions = { digest, at: Date.now() }
    }
    finally { this.publishingDecisions = false }
  }

  async workspaceRequest(body: Record<string, unknown>): Promise<unknown> {
    await this.load()
    if (!this.saved?.enabled || !this.saved.tokens) throw new Error('Register this desktop before connecting the central workspace')
    const identity = await this.worker.remoteOwner()
    if (!sameOwner(identity.owner, this.saved.tokens.registration.owner)) throw new Error('Central workspace belongs to another owner')
    await this.refresh()
    return this.signed('POST', '/api/runtime/v1/workspace', body, body.type === 'changes' ? 25000 : 0)
  }

  private async refreshTokens(): Promise<void> {
    if (!this.saved?.tokens) throw new Error('Register this desktop again')
    if (Date.parse(this.saved.tokens.expiresAt) >= Date.now() + 60000) return
    const tokens = await this.post('/api/mobile/v1/session/refresh', { refreshToken: this.saved.tokens.refreshToken, signature: signBytes(proofBytes('session-refresh', this.saved.id, sha256(this.saved.tokens.refreshToken)), this.saved.signing) })
    this.saved.tokens = this.tokens(tokens, this.saved.tokens.registration.owner, this.saved.tokens.registration)
    await this.save()
  }

  private async disable(): Promise<void> {
    await this.load(); this.saved!.enabled = false; await this.save()
    await this.worker.remote({ type: 'disable' })
  }

  stop(): void {
    this.stopping = true; this.abort.abort()
  }
}
