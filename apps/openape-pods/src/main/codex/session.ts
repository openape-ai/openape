import { randomBytes, timingSafeEqual } from 'node:crypto'
import { loginRequired, mcpSessionLifetime } from '../../contracts/mcp-session'
import type { McpSessionStatus, McpSessionVia, McpSessionView } from '../../contracts/mcp-session'
import type { OwnerSession } from '../connections/owner-session'
import { SignInEnded } from '../connections/owner-session'
import type { PhoneSignIn } from '../connections/owner'

/** One connected MCP shim process; its socket is the only place a session secret is sent. */
export interface McpPeer { readonly closed: boolean, send: (frame: Record<string, unknown>) => void }

export class LoginRequiredError extends Error {
  readonly code = loginRequired
  constructor(message: string, readonly session: McpSessionStatus) { super(message) }
}

export interface McpSessionDependencies {
  /** Proves the registered owner through the owner's logged-in apes CLI without a dialog; null when apes has no usable login. */
  apes?: (endsAt: number, signal: AbortSignal) => Promise<OwnerSession | null>
  /** Opens a phone confirmation at the IdP; its session settles once the owner approved the link. */
  phone?: (endsAt: number, signal: AbortSignal) => Promise<PhoneSignIn>
  /** Signs the registered owner in again in the browser and verifies the identity; the tokens stay in the returned session (null without an IdP, in synthetic fixture runs). */
  login: (endsAt: number, signal: AbortSignal) => Promise<OwnerSession | null>
  /** Native confirmation in the Pods app for the browser sign-in; the IdP issues codes silently while its own session lasts. */
  confirm: (signal: AbortSignal) => Promise<boolean>
  now?: () => number
  loginTimeout?: number
  /** Upper bound for the apes proof and for opening a phone confirmation, so a tool call is answered within the MCP client's timeout. */
  proofTimeout?: number
}

interface Session { secret: Buffer, expiresAt: number, owner: OwnerSession | null, via: McpSessionVia }
interface Pending { peer: McpPeer, controller: AbortController, via: McpSessionVia, link: string | null, expiresAt: number | null, ready: Promise<void> }
interface Outcome { state: 'expired' | 'denied', via: McpSessionVia | null, message?: string }

const poll = 'Then call pods_control with {"action":"session"} about every 5 seconds until its state is signed_in and retry this call; stop when the state is expired or denied, tell the owner, and retry this call once for a new sign-in. A session lasts one hour.'
const waiting = `Sign-in required (login_required). Another OpenApe Pods sign-in is waiting for the owner. Ask the owner to finish or cancel it, then retry this call. ${poll}`

// Owner-authenticated MCP sessions, each bound to the shim connection it was
// opened for. Three proofs open one: the owner's logged-in apes CLI (silent),
// a phone confirmation at the IdP, and as the last fallback the browser
// sign-in with the native confirmation. Secrets and the owner's tokens live
// only in memory: an app restart, a closed connection, End session or the
// fixed one-hour lifetime ends a session and discards its owner tokens.
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
    this.pending ??= this.start(peer)
    const pending = this.pending
    if (pending.peer !== peer) throw new LoginRequiredError(waiting, this.status(peer))
    await pending.ready
    throw new LoginRequiredError(this.instructions(pending) + note, this.status(peer))
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
    const pending = this.pending
    if (pending?.peer === peer) return { state: 'pending', via: pending.via, expiresAt: pending.expiresAt, ...(pending.link ? { link: pending.link } : {}) }
    const outcome = this.outcomes.get(peer)
    if (outcome) return { state: outcome.state, via: outcome.via, expiresAt: null, ...(outcome.message ? { message: outcome.message } : {}) }
    return { state: 'signed_out', via: null, expiresAt: null }
  }

  /** The waiting phone confirmation, which the account inbox shows to the owner as well. */
  phoneRequest(): { link: string, expiresAt: number } | null {
    const pending = this.pending
    return pending?.via === 'phone' && pending.link && pending.expiresAt ? { link: pending.link, expiresAt: pending.expiresAt } : null
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

  private start(peer: McpPeer): Pending {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(new SignInEnded('expired', 'The MCP sign-in timed out')), this.loginTimeout)
    timer.unref?.()
    const pending: Pending = { peer, controller, via: this.dependencies.phone ? 'phone' : 'browser', link: null, expiresAt: null, ready: Promise.resolve() }
    this.outcomes.delete(peer)
    let done: () => void = () => {}
    const ended = new Promise<void>((resolve) => { done = resolve })
    pending.ready = this.open(pending, done).catch((error: unknown) => { console.error('Could not start the MCP owner sign-in:', error instanceof Error ? error.message : 'unknown error'); done() })
    void ended.then(() => {
      clearTimeout(timer)
      if (this.pending === pending) this.pending = null
    })
    return pending
  }

  /** Opens the phone confirmation, or the browser sign-in when that fails; resolves `ready` once the owner can be told, and `done` when it ended. */
  private async open(pending: Pending, done: () => void): Promise<void> {
    const { peer, controller } = pending
    const expiresAt = this.now() + mcpSessionLifetime
    const finish = (work: Promise<void>) => {
      void work.catch((error: unknown) => {
        const ended = error instanceof SignInEnded ? error : controller.signal.reason instanceof SignInEnded ? controller.signal.reason : null
        const message = error instanceof Error ? error.message : 'unknown error'
        console.error('MCP owner sign-in failed:', message)
        if (!peer.closed && !this.sessions.has(peer)) this.outcomes.set(peer, { state: ended?.outcome ?? 'denied', via: pending.via, message: ended?.message ?? message })
      }).finally(done)
    }
    const phone = await this.openPhone(expiresAt, controller.signal)
    if (phone) {
      pending.link = phone.link; pending.expiresAt = phone.expiresAt
      finish(phone.session.then((owner) => {
        if (peer.closed || controller.signal.aborted) { void owner.close(); throw controller.signal.reason ?? new Error('The MCP connection closed during sign-in') }
        this.establish(peer, owner, expiresAt, 'phone')
      }))
      return
    }
    pending.via = 'browser'
    finish(this.activate(peer, expiresAt, controller.signal))
  }

  private async openPhone(expiresAt: number, signal: AbortSignal): Promise<PhoneSignIn | null> {
    if (!this.dependencies.phone) return null
    // The signal also bounds the wait for the owner's approval, so only opening the channel is bounded here.
    const opening = this.dependencies.phone(expiresAt, signal)
    try {
      const phone = await bounded(opening, this.proofTimeout)
      // A rejection that arrives after the session is no longer awaited must not become unhandled.
      phone.session.catch(() => {})
      return phone
    }
    catch (error) {
      // A channel that opens too late was never shown to the owner; whatever it yields is discarded.
      void opening.then(late => late.session.then(owner => owner.close()), () => {}).catch(() => {})
      console.error('Could not open a phone confirmation for the MCP session:', error instanceof Error ? error.message : 'unknown error')
      return null
    }
  }

  private async activate(peer: McpPeer, expiresAt: number, signal: AbortSignal): Promise<void> {
    const owner = await this.dependencies.login(expiresAt, signal)
    let accepted = false
    try { accepted = !peer.closed && !signal.aborted && await this.dependencies.confirm(signal) && !peer.closed && !signal.aborted }
    finally { if (!accepted && owner) await owner.close() }
    if (!accepted) throw new SignInEnded('denied', 'The owner declined the MCP session in the OpenApe Pods app')
    this.establish(peer, owner, expiresAt, 'browser')
  }

  private instructions(pending: Pending): string {
    if (pending.via === 'phone' && pending.link) return `Sign-in required (login_required). Tell the owner to open this link and approve the OpenApe Pods sign-in on the phone or in any browser signed in at the identity provider: ${pending.link} . The same request waits in the owner's Pods inbox as "Codex-Anmeldung bestätigen". The link expires at ${new Date(pending.expiresAt ?? 0).toISOString()}. Alternatively the owner can run apes login on this Mac; the next call then signs in without confirmation. ${poll}`
    return `Sign-in required (login_required). OpenApe Pods opened the owner's DDISA sign-in in the browser on this Mac. Ask the owner to complete it there and confirm the request in the OpenApe Pods app. ${poll}`
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
