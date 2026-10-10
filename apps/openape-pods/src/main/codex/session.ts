import { randomBytes, timingSafeEqual } from 'node:crypto'
import { loginRequired, mcpSessionLifetime } from '../../contracts/mcp-session'
import type { McpSessionStatus, McpSessionVia, McpSessionView } from '../../contracts/mcp-session'
import type { OwnerSession } from '../connections/owner-session'
import { SignInEnded } from '../connections/owner-session'

/** One connected MCP shim process; its socket is the only place a session secret is sent. */
export interface McpPeer { readonly closed: boolean, send: (frame: Record<string, unknown>) => void }

export class LoginRequiredError extends Error {
  readonly code = loginRequired
  constructor(message: string, readonly session: McpSessionStatus) { super(message) }
}

export interface McpSessionDependencies {
  /** Proves the registered owner through the owner's logged-in apes CLI without a dialog; null when apes has no usable login. */
  apes?: (endsAt: number, signal: AbortSignal) => Promise<OwnerSession | null>
  /** Signs the registered owner in again in the browser and verifies the identity; the tokens stay in the returned session (null without an IdP, in synthetic fixture runs). */
  login: (endsAt: number, signal: AbortSignal) => Promise<OwnerSession | null>
  /** Native confirmation in the Pods app for the browser sign-in; the IdP issues codes silently while its own session lasts. */
  confirm: (signal: AbortSignal) => Promise<boolean>
  now?: () => number
  loginTimeout?: number
  /** Upper bound for the apes proof, so a tool call is answered within the MCP client's timeout. */
  proofTimeout?: number
}

interface Session { secret: Buffer, expiresAt: number, owner: OwnerSession | null, via: McpSessionVia }
interface Pending { peer: McpPeer, controller: AbortController, expiresAt: number }
interface Outcome { state: 'expired' | 'denied', via: McpSessionVia, message?: string }

const poll = 'Then call pods_control with {"action":"session"} about every 5 seconds until its state is signed_in and retry this call; stop when the state is expired or denied, tell the owner, and retry this call once for a new sign-in. A session lasts one hour.'
const started = `Sign-in required (login_required). OpenApe Pods opened the owner's DDISA sign-in in the browser on this Mac. Ask the owner to complete it there and confirm the request in the OpenApe Pods app. While the owner is logged in with the apes CLI on this Mac (apes login), the next call signs in without either step. ${poll}`
const waiting = `Sign-in required (login_required). Another OpenApe Pods sign-in is waiting for the owner. Ask the owner to finish or cancel it in the browser and in the OpenApe Pods app, then retry this call. ${poll}`

// Owner-authenticated MCP sessions, each bound to the shim connection it was
// opened for. The owner's logged-in apes CLI opens one silently; otherwise the
// owner signs in in the browser and confirms natively. Secrets and the owner's
// tokens live only in memory: an app restart, a closed connection, End session
// or the fixed one-hour lifetime ends a session and discards its owner tokens.
export class McpOwnerSessions {
  private readonly sessions = new Map<McpPeer, Session>()
  private readonly outcomes = new Map<McpPeer, Outcome>()
  private readonly proofs = new Map<McpPeer, Promise<true | string | null>>()
  private pending: Pending | null = null
  private readonly now: () => number
  private readonly loginTimeout: number
  private readonly proofTimeout: number
  constructor(private readonly dependencies: McpSessionDependencies) {
    this.now = dependencies.now ?? Date.now
    this.loginTimeout = dependencies.loginTimeout ?? 300000
    this.proofTimeout = dependencies.proofTimeout ?? 15000
  }

  /**
   * Accepts only the connection's own unexpired secret. Anything else ends that session; a valid apes login then
   * opens a new one for this call, otherwise the owner is asked and the call fails with login_required.
   */
  async authorize(peer: McpPeer, secret: string | undefined): Promise<void> {
    const session = this.sessions.get(peer)
    if (session && this.live(session) && secret !== undefined && same(secret, session.secret)) return
    if (session) this.expire(peer, session)
    const apes = await this.proveWithApes(peer)
    if (apes === true) return
    const note = apes ? ` The apes login on this Mac was not accepted: ${apes}.` : ''
    if (this.pending && this.pending.peer !== peer) throw new LoginRequiredError(waiting, this.status(peer))
    if (!this.pending) this.start(peer)
    throw new LoginRequiredError(started + note, this.status(peer))
  }

  /** The owner identity of this connection's current session; grant decisions are refused without it. */
  owner(peer: McpPeer): OwnerSession | null {
    const session = this.sessions.get(peer)
    if (!session || !this.live(session) || !session.owner?.active) return null
    return session.owner
  }

  /** What the tool user polls while the owner confirms; reading it never starts a sign-in. */
  status(peer: McpPeer): McpSessionStatus {
    const session = this.sessions.get(peer)
    if (session && this.live(session)) return { state: 'signed_in', via: session.via, expiresAt: session.expiresAt }
    if (session) this.expire(peer, session)
    if (this.pending?.peer === peer) return { state: 'pending', via: 'browser', expiresAt: this.pending.expiresAt }
    const outcome = this.outcomes.get(peer)
    if (outcome) return { state: outcome.state, via: outcome.via, expiresAt: null, ...(outcome.message ? { message: outcome.message } : {}) }
    return { state: 'signed_out', via: null, expiresAt: null }
  }

  disconnect(peer: McpPeer): void {
    void this.remove(peer)
    this.outcomes.delete(peer)
    if (this.pending?.peer === peer) this.pending.controller.abort(new Error('The MCP connection closed during sign-in'))
  }

  /** Ends every session; the returned promise settles when the tokens Pods minted are revoked at the IdP. */
  end(): Promise<void> {
    const closing = Array.from(this.sessions.keys(), peer => this.remove(peer))
    this.outcomes.clear()
    this.pending?.controller.abort(new Error('The owner ended the MCP session'))
    return Promise.all(closing).then(() => undefined)
  }

  view(): McpSessionView {
    for (const [peer, session] of this.sessions) {
      if (!this.live(session)) this.expire(peer, session)
    }
    const ends = Array.from(this.sessions.values(), session => session.expiresAt)
    return { expiresAt: ends.length ? Math.max(...ends) : null, pending: !!this.pending }
  }

  private live(session: Session): boolean {
    return this.now() < session.expiresAt && (!session.owner || session.owner.active)
  }

  private expire(peer: McpPeer, session: Session): void {
    if (!this.live(session)) this.outcomes.set(peer, { state: 'expired', via: session.via })
    void this.remove(peer)
  }

  // Closing never rejects: a failed revocation is logged by the session itself.
  private remove(peer: McpPeer): Promise<void> {
    const owner = this.sessions.get(peer)?.owner
    this.sessions.delete(peer)
    return owner ? owner.close() : Promise.resolve()
  }

  private establish(peer: McpPeer, owner: OwnerSession | null, expiresAt: number, via: McpSessionVia): void {
    const secret = randomBytes(32)
    void this.remove(peer)
    this.outcomes.delete(peer)
    this.sessions.set(peer, { secret, expiresAt, owner, via })
    peer.send({ session: secret.toString('base64url'), expiresAt })
  }

  /** One apes proof per connection at a time: true when it opened the session, the refusal reason, or null without an apes login. */
  private proveWithApes(peer: McpPeer): Promise<true | string | null> {
    const apes = this.dependencies.apes
    if (!apes) return Promise.resolve(null)
    let proof = this.proofs.get(peer)
    if (!proof) {
      proof = this.apesProof(peer, apes).finally(() => this.proofs.delete(peer))
      this.proofs.set(peer, proof)
    }
    return proof
  }

  private async apesProof(peer: McpPeer, apes: NonNullable<McpSessionDependencies['apes']>): Promise<true | string | null> {
    const expiresAt = this.now() + mcpSessionLifetime
    let owner: OwnerSession | null
    const proving = apes(expiresAt, AbortSignal.timeout(this.proofTimeout))
    try { owner = await bounded(proving, this.proofTimeout) }
    catch (error) {
      // A proof that completes after the call gave up is discarded.
      void proving.then(late => late?.close(), () => {})
      const reason = error instanceof Error ? error.message : 'unknown error'
      console.error('The apes login was not accepted for an MCP session:', reason)
      return reason
    }
    if (!owner) return null
    if (peer.closed) { void owner.close(); return null }
    if (this.pending?.peer === peer) this.pending.controller.abort(new Error('Signed in with the apes login'))
    this.establish(peer, owner, expiresAt, 'apes')
    return true
  }

  private start(peer: McpPeer): void {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(new SignInEnded('expired', 'The MCP sign-in timed out')), this.loginTimeout)
    timer.unref?.()
    const pending = { peer, controller, expiresAt: this.now() + this.loginTimeout }
    this.pending = pending
    this.outcomes.delete(peer)
    void this.activate(peer, controller.signal)
      .catch((error: unknown) => {
        const ended = error instanceof SignInEnded ? error : controller.signal.reason instanceof SignInEnded ? controller.signal.reason : null
        const message = ended?.message ?? (error instanceof Error ? error.message : 'unknown error')
        console.error('MCP owner sign-in failed:', message)
        if (!peer.closed && !this.sessions.has(peer)) this.outcomes.set(peer, { state: ended?.outcome ?? 'denied', via: 'browser', message })
      })
      .finally(() => { clearTimeout(timer); if (this.pending === pending) this.pending = null })
  }

  private async activate(peer: McpPeer, signal: AbortSignal): Promise<void> {
    const expiresAt = this.now() + mcpSessionLifetime
    const owner = await this.dependencies.login(expiresAt, signal)
    let accepted = false
    try { accepted = !peer.closed && !signal.aborted && await this.dependencies.confirm(signal) && !peer.closed && !signal.aborted }
    finally { if (!accepted && owner) await owner.close() }
    if (!accepted) throw signal.reason instanceof SignInEnded ? signal.reason : new SignInEnded('denied', 'The owner declined the MCP session in the OpenApe Pods app')
    this.establish(peer, owner, expiresAt, 'browser')
  }
}

function bounded<T>(work: Promise<T>, timeout: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const limit = new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error('Opening the sign-in timed out')), timeout) })
  return Promise.race([work, limit]).finally(() => clearTimeout(timer))
}

function same(value: string, expected: Buffer): boolean {
  const actual = Buffer.from(value, 'base64url')
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}
