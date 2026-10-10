import { randomBytes, timingSafeEqual } from 'node:crypto'
import { loginRequired, mcpSessionLifetime } from '../../contracts/mcp-session'
import type { McpSessionView } from '../../contracts/mcp-session'
import type { OwnerSession } from '../connections/owner-session'

/** One connected MCP shim process; its socket is the only place a session secret is sent. */
export interface McpPeer { readonly closed: boolean, send: (frame: Record<string, unknown>) => void }

export class LoginRequiredError extends Error {
  readonly code = loginRequired
}

export interface McpSessionDependencies {
  /** Signs the registered owner in again in the browser and verifies the identity; the tokens stay in the returned session (null without an IdP, in synthetic fixture runs). */
  login: (endsAt: number, signal: AbortSignal) => Promise<OwnerSession | null>
  /** Native confirmation in the Pods app; the IdP issues codes silently while its own session lasts. */
  confirm: (signal: AbortSignal) => Promise<boolean>
  now?: () => number
  loginTimeout?: number
}

const started = 'Sign-in required (login_required). OpenApe Pods opened the browser for the owner\'s DDISA sign-in. Ask the owner to complete the sign-in in the browser and then confirm the request in the OpenApe Pods app, then retry this call. The session lasts one hour.'
const waiting = 'Sign-in required (login_required). Another OpenApe Pods sign-in is waiting for the owner. Ask the owner to finish or cancel it in the browser and in the OpenApe Pods app, then retry this call.'

// Owner-authenticated MCP sessions, each bound to the shim connection that
// started its sign-in. Secrets and the owner's tokens live only in memory: an
// app restart, a closed connection, End session or the fixed one-hour lifetime
// ends a session and discards its owner tokens.
export class McpOwnerSessions {
  private readonly sessions = new Map<McpPeer, { secret: Buffer, expiresAt: number, owner: OwnerSession | null }>()
  private pending: { peer: McpPeer, controller: AbortController } | null = null
  private readonly now: () => number
  private readonly loginTimeout: number
  constructor(private readonly dependencies: McpSessionDependencies) {
    this.now = dependencies.now ?? Date.now
    this.loginTimeout = dependencies.loginTimeout ?? 300000
  }

  /** Accepts only the connection's own unexpired secret; anything else ends that session and asks for sign-in. */
  authorize(peer: McpPeer, secret: string | undefined): void {
    const session = this.sessions.get(peer)
    if (session && this.now() < session.expiresAt && secret !== undefined && same(secret, session.secret)) return
    void this.remove(peer)
    if (this.pending && this.pending.peer !== peer) throw new LoginRequiredError(waiting)
    if (!this.pending) this.start(peer)
    throw new LoginRequiredError(started)
  }

  /** The owner identity of this connection's current session; grant decisions are refused without it. */
  owner(peer: McpPeer): OwnerSession | null {
    const session = this.sessions.get(peer)
    if (!session || this.now() >= session.expiresAt || !session.owner?.active) return null
    return session.owner
  }

  disconnect(peer: McpPeer): void {
    void this.remove(peer)
    if (this.pending?.peer === peer) this.pending.controller.abort(new Error('The MCP connection closed during sign-in'))
  }

  /** Ends every session; the returned promise settles when their owner tokens are revoked at the IdP. */
  end(): Promise<void> {
    const closing = Array.from(this.sessions.keys(), peer => this.remove(peer))
    this.pending?.controller.abort(new Error('The owner ended the MCP session'))
    return Promise.all(closing).then(() => undefined)
  }

  view(): McpSessionView {
    const now = this.now()
    for (const [peer, session] of this.sessions) {
      if (now >= session.expiresAt) void this.remove(peer)
    }
    const ends = Array.from(this.sessions.values(), session => session.expiresAt)
    return { expiresAt: ends.length ? Math.max(...ends) : null, pending: !!this.pending }
  }

  private start(peer: McpPeer): void {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(new Error('The MCP sign-in timed out')), this.loginTimeout)
    timer.unref?.()
    const pending = { peer, controller }
    this.pending = pending
    void this.activate(peer, controller.signal)
      .catch((error: unknown) => console.error('MCP owner sign-in failed:', error instanceof Error ? error.message : 'unknown error'))
      .finally(() => { clearTimeout(timer); if (this.pending === pending) this.pending = null })
  }

  // Closing never rejects: a failed revocation is logged by the session itself.
  private remove(peer: McpPeer): Promise<void> {
    const owner = this.sessions.get(peer)?.owner
    this.sessions.delete(peer)
    return owner ? owner.close() : Promise.resolve()
  }

  private async activate(peer: McpPeer, signal: AbortSignal): Promise<void> {
    const expiresAt = this.now() + mcpSessionLifetime
    const owner = await this.dependencies.login(expiresAt, signal)
    let accepted = false
    try { accepted = !peer.closed && !signal.aborted && await this.dependencies.confirm(signal) && !peer.closed && !signal.aborted }
    finally { if (!accepted && owner) await owner.close() }
    if (!accepted) return
    const secret = randomBytes(32)
    await this.remove(peer)
    this.sessions.set(peer, { secret, expiresAt, owner })
    peer.send({ session: secret.toString('base64url'), expiresAt })
  }
}

function same(value: string, expected: Buffer): boolean {
  const actual = Buffer.from(value, 'base64url')
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}
