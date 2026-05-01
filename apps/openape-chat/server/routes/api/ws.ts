import type { ChatPeer } from '../../utils/realtime'
import { createRemoteJWKS, verifyJWT } from '@openape/core'
import { useRuntimeConfig } from 'nitropack/runtime'
import { registerPeer, unregisterPeer } from '../../utils/realtime'

interface DDISAClaims {
  sub?: string
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

async function authenticateUpgrade(token: string): Promise<AuthCtx> {
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
