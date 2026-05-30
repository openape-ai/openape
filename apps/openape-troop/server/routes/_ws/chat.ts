// WS handler for troop chat (M4 of plan 01KSWSHPA4C320VV0BKK98EZ0V).
//
// Two peer kinds connect:
//
//   - **Owner (browser tab)** — same-origin WS, auth via the SP session
//     cookie. The handler reads getSpSession() on the upgrade request to
//     resolve the operator's email. Browser doesn't need to pass any
//     custom token; cookies travel naturally because troop's UI talks to
//     troop's WS on the same origin.
//
//   - **Agent (bridge process)** — cross-origin from container, auth via
//     `?token=<agent_jwt>` query string. Verified against the IdP JWKS.
//     The bridge's DDISA agent JWT carries act='agent' + sub=<agent
//     email>; we use the sub to look up every chat where chatAgent
//     matches and pre-subscribe the peer to all of them.
//
// Frames the server accepts from peers:
//   - { type: 'subscribe', chat_id }   browser tab tells us which chat
//                                       to forward broadcasts for
//   - { type: 'unsubscribe', chat_id } symmetric
//
// Frames the server sends out (broadcast via chat-realtime hub):
//   - { type: 'message',   chat_id, payload: ChatMessage }
//   - { type: 'edit',      chat_id, payload: ChatMessage }
//   - { type: 'streaming-status', chat_id, payload: ChatMessage }

import { createRemoteJWKS, verifyJWT } from '@openape/core'
import { useRuntimeConfig } from 'nitropack/runtime'
import { and, eq } from 'drizzle-orm'
import { useDb } from '../../database/drizzle'
import { agents, chats } from '../../database/schema'
import type { ChatPeer } from '../../utils/chat-realtime'
import { registerPeer, unregisterPeer } from '../../utils/chat-realtime'
// getSpSession is auto-imported by the @openape/nuxt-auth-sp module — no explicit import needed.
declare function getSpSession(event: unknown): Promise<{ data: { claims?: { sub?: string } } }>

interface DDISAClaims {
  sub?: string
  act?: 'human' | 'agent' | string
}

interface AuthCtx {
  email: string
  act: 'human' | 'agent'
}

interface PeerCtx extends AuthCtx {
  chatPeer: ChatPeer
}

let _jwks: ReturnType<typeof createRemoteJWKS> | null = null
function jwks() {
  if (!_jwks) {
    const idpUrl = useRuntimeConfig().public.idpUrl as string
    _jwks = createRemoteJWKS(new URL('/.well-known/jwks.json', idpUrl).toString())
  }
  return _jwks
}

const ctxByPeerId = new Map<string, PeerCtx>()

async function authenticateAgentToken(token: string): Promise<AuthCtx> {
  const { payload } = await verifyJWT<DDISAClaims>(token, jwks())
  const email = payload.sub
  if (!email) throw new Error('Token missing sub')
  if (payload.act !== 'agent') throw new Error('Not an agent token')
  return { email, act: 'agent' }
}

/**
 * Read the operator's email from the session-cookie path. Returns null
 * when no session is present (anonymous upgrade attempt) — the caller
 * then tries the agent-token path.
 *
 * The `request` shape here is the H3 event-ish object Crossws hands us
 * on the upgrade; the SP session helper reads cookies off of it.
 */
async function authenticateSession(request: { headers?: Record<string, string> | { get?: (k: string) => string | null }, url?: string }): Promise<AuthCtx | null> {
  try {
    // Crossws passes a `Request`-like object whose headers behave like
    // a Headers map. The SP session module accepts h3-style events;
    // we shim minimally so it can read the cookie. If the API surface
    // doesn't fit, surface null and let the caller fall through to
    // token auth.
    const session = await getSpSession(request as unknown as Parameters<typeof getSpSession>[0])
    const claims = (session.data as { claims?: { sub?: string } })?.claims
    if (!claims?.sub) return null
    return { email: claims.sub, act: 'human' }
  }
  catch { return null }
}

async function preSubscribeAgent(peer: ChatPeer, agentEmail: string): Promise<void> {
  const db = useDb()
  const rows = await db.select({ id: chats.id }).from(chats).where(eq(chats.agentEmail, agentEmail))
  for (const r of rows) peer.chatIds.add(r.id)
}

/**
 * For a human peer subscribing to a chat by id, verify they're the
 * owner half of that chat. Without this guard a logged-in user could
 * subscribe to any chat_id by guessing the UUID.
 */
async function canHumanSubscribe(email: string, chatId: string): Promise<boolean> {
  const db = useDb()
  const row = await db.select({ owner: chats.ownerEmail })
    .from(chats)
    .where(eq(chats.id, chatId))
    .limit(1)
  return row[0]?.owner === email
}

export default defineWebSocketHandler({
  async upgrade(request) {
    const url = new URL(request.url ?? '/', 'http://localhost')
    const token = url.searchParams.get('token')
    if (token) {
      try { await authenticateAgentToken(token) }
      catch { throw createError({ statusCode: 401, statusMessage: 'Invalid agent token' }) }
      return
    }
    // No token → must have a session cookie. We don't fully verify here
    // (cookie parsing happens in open()); reject the upgrade only if
    // there's no session-cookie header at all.
    const headers = request.headers as unknown as { get?: (k: string) => string | null, cookie?: string }
    const cookie = (typeof headers?.get === 'function' ? headers.get('cookie') : null) ?? headers?.cookie ?? ''
    if (!cookie.includes('openape')) {
      throw createError({ statusCode: 401, statusMessage: 'Missing session cookie or ?token=' })
    }
  },

  async open(peer) {
    try {
      const url = new URL(peer.request.url ?? '/', 'http://localhost')
      const token = url.searchParams.get('token')
      let ctx: AuthCtx | null = null
      if (token) {
        ctx = await authenticateAgentToken(token)
      }
      else {
        ctx = await authenticateSession({ headers: peer.request.headers as unknown as Record<string, string>, url: peer.request.url })
      }
      if (!ctx) {
        peer.send(JSON.stringify({ type: 'error', message: 'Unauthenticated' }))
        peer.close(1008, 'Unauthenticated')
        return
      }
      const chatPeer: ChatPeer = {
        email: ctx.email,
        chatIds: new Set(),
        send: msg => peer.send(msg),
        kind: ctx.act,
      }
      ctxByPeerId.set(peer.id, { ...ctx, chatPeer })
      registerPeer(chatPeer)
      if (ctx.act === 'agent') {
        await preSubscribeAgent(chatPeer, ctx.email)
        peer.send(JSON.stringify({
          type: 'hello',
          email: ctx.email,
          act: ctx.act,
          chats: [...chatPeer.chatIds],
        }))
      }
      else {
        peer.send(JSON.stringify({ type: 'hello', email: ctx.email, act: ctx.act }))
      }
    }
    catch {
      peer.send(JSON.stringify({ type: 'error', message: 'open() failed' }))
      peer.close(1008, 'open() failed')
    }
  },

  async message(peer, message) {
    const ctx = ctxByPeerId.get(peer.id)
    if (!ctx) return
    let frame: { type?: string, chat_id?: string }
    try {
      const raw = typeof message === 'string'
        ? message
        : typeof (message as { text?: () => string }).text === 'function'
          ? (message as { text: () => string }).text()
          : String(message)
      frame = JSON.parse(raw) as typeof frame
    }
    catch { return }
    if (frame.type === 'subscribe' && typeof frame.chat_id === 'string') {
      if (ctx.act === 'human' && !(await canHumanSubscribe(ctx.email, frame.chat_id))) {
        peer.send(JSON.stringify({ type: 'error', message: 'forbidden' }))
        return
      }
      ctx.chatPeer.chatIds.add(frame.chat_id)
      peer.send(JSON.stringify({ type: 'subscribed', chat_id: frame.chat_id }))
    }
    else if (frame.type === 'unsubscribe' && typeof frame.chat_id === 'string') {
      ctx.chatPeer.chatIds.delete(frame.chat_id)
    }
  },

  close(peer) {
    const ctx = ctxByPeerId.get(peer.id)
    if (!ctx) return
    ctxByPeerId.delete(peer.id)
    unregisterPeer(ctx.chatPeer)
  },
})

// Silences "unused-import" — `agents` is reserved for future
// audit-time joins between chat events and the agent registry.
void agents
void and
