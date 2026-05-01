import type { ChatPeer } from '../../utils/realtime'
import { createRemoteJWKS, verifyJWT } from '@openape/core'
import { jwtVerify } from 'jose'
import { useRuntimeConfig } from 'nitropack/runtime'
import { registerPeer, unregisterPeer } from '../../utils/realtime'

interface DDISAClaims {
  sub?: string
  act?: 'human' | 'agent' | string
}

interface WsTokenClaims {
  email?: string
  act?: 'human' | 'agent' | string
}

let _jwks: ReturnType<typeof createRemoteJWKS> | null = null
function jwks() {
  if (!_jwks) {
    const idpUrl = useRuntimeConfig().public.idpUrl as string
    _jwks = createRemoteJWKS(new URL('/.well-known/jwks.json', idpUrl).toString())
  }
  return _jwks
}

let _wsTokenKey: Uint8Array | null = null
function wsTokenKey(): Uint8Array | null {
  if (!_wsTokenKey) {
    const secret = (useRuntimeConfig().openapeSp?.sessionSecret as string) || ''
    if (!secret) return null
    _wsTokenKey = new TextEncoder().encode(secret)
  }
  return _wsTokenKey
}

// Per-peer auth state. Crossws gives a stable `peer.id`; we attach the
// resolved email/act under our own key so close() can unregister cleanly.
interface AuthCtx {
  email: string
  act: 'human' | 'agent'
}

interface PeerCtx extends AuthCtx {
  chatPeer: ChatPeer
}

const ctxByPeerId = new Map<string, PeerCtx>()

/**
 * Two token types resolve here:
 *   1. JWKS-verified IdP-issued JWT — used by the Claude Code plugin and
 *      any spawned agent, since they hold a real OpenApe access token in
 *      their `auth.json`.
 *   2. HS256-signed WS-token issued by `/api/ws-token` — used by the Web
 *      UI, which can't pass an Authorization header on a WS upgrade and
 *      doesn't have a JWKS-signed token in its session anyway.
 *
 * We try the HS256 path first when the local secret is configured because
 * it's the common case (most connections come from the browser); on
 * mismatch we fall through to JWKS verification.
 */
async function authenticateUpgrade(token: string): Promise<AuthCtx> {
  const localKey = wsTokenKey()
  if (localKey) {
    try {
      const { payload } = await jwtVerify<WsTokenClaims>(token, localKey, {
        issuer: 'chat.openape.ai',
        audience: 'chat.openape.ai/ws',
        algorithms: ['HS256'],
      })
      if (payload.email) {
        return { email: payload.email, act: payload.act === 'agent' ? 'agent' : 'human' }
      }
    }
    catch {
      // Not a local token — fall through to JWKS.
    }
  }

  const { payload } = await verifyJWT<DDISAClaims>(token, jwks())
  const email = payload.sub
  if (!email) throw new Error('Token missing sub')
  return { email, act: payload.act === 'agent' ? 'agent' : 'human' }
}

export default defineWebSocketHandler({
  async upgrade(request) {
    const url = new URL(request.url, 'http://localhost')
    const token = url.searchParams.get('token')
    if (!token) {
      throw createError({ statusCode: 401, statusMessage: 'Missing token' })
    }
    try {
      // Verify upfront so we reject the upgrade with a proper 401 instead
      // of disconnecting silently after a successful handshake. The result
      // isn't reused — `open()` re-runs the verify against `peer.request`
      // because Nitro doesn't pass the verified context through.
      await authenticateUpgrade(token)
    }
    catch {
      throw createError({ statusCode: 401, statusMessage: 'Invalid token' })
    }
  },

  async open(peer) {
    // Re-verify on open. The token is in the request URL; Crossws exposes
    // it via `peer.request.url`. (We can't trust the upgrade handler's
    // mutation of `request` because Nitro recreates the object.)
    try {
      const url = new URL(peer.request.url, 'http://localhost')
      const token = url.searchParams.get('token')
      if (!token) {
        peer.send(JSON.stringify({ type: 'error', message: 'Missing token' }))
        peer.close(1008, 'Missing token')
        return
      }
      const ctx = await authenticateUpgrade(token)
      const chatPeer: ChatPeer = {
        email: ctx.email,
        send: msg => peer.send(msg),
      }
      ctxByPeerId.set(peer.id, { ...ctx, chatPeer })
      registerPeer(chatPeer)
      peer.send(JSON.stringify({ type: 'hello', email: ctx.email, act: ctx.act }))
    }
    catch {
      peer.send(JSON.stringify({ type: 'error', message: 'Invalid token' }))
      peer.close(1008, 'Invalid token')
    }
  },

  message(peer, _message) {
    // v1 is server-push only. Clients post via REST, the broadcast hub
    // pushes notifications via this socket. Ping/pong is handled by the
    // browser/Crossws layer automatically.
    void peer
    void _message
  },

  close(peer) {
    const ctx = ctxByPeerId.get(peer.id)
    if (!ctx) return
    ctxByPeerId.delete(peer.id)
    unregisterPeer(ctx.chatPeer)
  },
})
