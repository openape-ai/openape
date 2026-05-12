import { createRemoteJWKS, verifyJWT } from '@openape/core'
import { useRuntimeConfig } from 'nitropack/runtime'
import { parseAgentEmail } from '../../utils/agent-email'
import { registerNestPeer, touchNestPeer, unregisterNestPeerById } from '../../utils/nest-registry'
import { resolveSpawnIntent } from '../../utils/spawn-intents'

// Control-plane WS for local nest daemons. Each connected peer
// represents a Mac (or any host) running `openape-nest`, owned by
// the DDISA-authenticated `sub` of the bearer token used at upgrade.
//
// Frames in (nest → troop):
//   - hello { host_id, hostname, version }   — must be the first message
//   - heartbeat                              — bumps lastSeenAt, no reply
//   - spawn-result { intent_id, ok, agent_email?, error? }
//
// Frames out (troop → nest):
//   - config-update { agent_email }          — nest re-syncs the named agent
//   - spawn-intent { intent_id, name, bridge?, soul?, skills? }
//   - reload-bridge { name }                 — pm2 reload, no fresh sync
//
// Auth model: same DDISA-JWT pattern as chat's WS — bearer signed
// by id.openape.ai's JWKS. We accept two flavours of caller:
//
//   - `act: human` — owner-direct connection (UI/dev tooling).
//     ownerEmail = JWT `sub`.
//   - `act: agent` — the nest itself, signed with its own DDISA
//     keypair (see `apes nest enroll`). The agent email encodes
//     its owner (`<name>-<hash>+<owner-local>+<owner-domain>@id…`),
//     so we resolve ownerEmail from parseAgentEmail. This is the
//     normal daemon path — the nest reads its act:agent JWT from
//     `~/.openape/nest/.config/apes/auth.json` and uses it as
//     bearer here.
//
// Either way the WS connection is owner-scoped — broadcasts and
// spawn-intents fan out per ownerEmail.

interface DDISAClaims {
  sub?: string
  act?: 'human' | 'agent' | string
}

let _jwks: ReturnType<typeof createRemoteJWKS> | null = null
function jwks() {
  if (!_jwks) {
    const idpUrl = useRuntimeConfig().public.idpUrl as string ?? 'https://id.openape.ai'
    _jwks = createRemoteJWKS(new URL('/.well-known/jwks.json', idpUrl).toString())
  }
  return _jwks
}

interface AuthCtx { ownerEmail: string }
const authByPeerId = new Map<string, AuthCtx>()

async function authenticateUpgrade(token: string): Promise<AuthCtx> {
  const { payload } = await verifyJWT<DDISAClaims>(token, jwks())
  if (!payload.sub) throw new Error('token missing sub')
  if (payload.act === 'human') {
    return { ownerEmail: payload.sub.toLowerCase() }
  }
  if (payload.act === 'agent') {
    const parsed = parseAgentEmail(payload.sub)
    if (!parsed) {
      throw new Error('agent token sub does not match the agent+owner email pattern')
    }
    return { ownerEmail: parsed.ownerEmail }
  }
  throw new Error('token must be act:human or act:agent')
}

interface HelloFrame { type: 'hello', host_id: string, hostname: string, version: string }
interface HeartbeatFrame { type: 'heartbeat' }
interface SpawnResultFrame {
  type: 'spawn-result'
  intent_id: string
  ok: boolean
  agent_email?: string
  error?: string
}
type InboundFrame = HelloFrame | HeartbeatFrame | SpawnResultFrame | { type: string }

function parseFrame(raw: unknown): InboundFrame | null {
  const text = typeof raw === 'string'
    ? raw
    : typeof (raw as { text?: () => string }).text === 'function'
      ? (raw as { text: () => string }).text()
      : String(raw)
  try { return JSON.parse(text) as InboundFrame }
  catch { return null }
}

export default defineWebSocketHandler({
  async upgrade(request) {
    const url = new URL(request.url, 'http://localhost')
    const token = url.searchParams.get('token')
    if (!token) throw createError({ statusCode: 401, statusMessage: 'Missing token' })
    try { await authenticateUpgrade(token) }
    catch { throw createError({ statusCode: 401, statusMessage: 'Invalid token' }) }
  },

  async open(peer) {
    // Re-verify on open (the upgrade-context object is not the same
    // event as open's peer per nitro/crossws; verify state doesn't
    // flow through).
    try {
      const url = new URL(peer.request.url, 'http://localhost')
      const token = url.searchParams.get('token')
      if (!token) {
        peer.send(JSON.stringify({ type: 'error', message: 'missing token' }))
        peer.close(1008, 'missing token')
        return
      }
      const ctx = await authenticateUpgrade(token)
      authByPeerId.set(peer.id, ctx)
      // Tell the nest we accepted the auth — it doesn't strictly need
      // this, but the round-trip confirms the WS plumbing is alive
      // before it sends the hello frame.
      peer.send(JSON.stringify({ type: 'welcome', owner: ctx.ownerEmail }))
    }
    catch (err) {
      peer.send(JSON.stringify({ type: 'error', message: 'invalid token' }))
      peer.close(1008, 'invalid token')
      void err
    }
  },

  message(peer, message) {
    const ctx = authByPeerId.get(peer.id)
    if (!ctx) return
    const frame = parseFrame(message)
    if (!frame) return
    if (frame.type === 'hello') {
      const f = frame as HelloFrame
      if (!f.host_id || !f.hostname) return
      registerNestPeer({
        ownerEmail: ctx.ownerEmail,
        hostId: f.host_id,
        hostname: f.hostname,
        version: f.version ?? 'unknown',
        lastSeenAt: Math.floor(Date.now() / 1000),
        peerId: peer.id,
        send: (out) => {
          try { peer.send(JSON.stringify(out)); return true }
          catch { return false }
        },
      })
      peer.send(JSON.stringify({ type: 'ack' }))
      return
    }
    if (frame.type === 'heartbeat') {
      touchNestPeer(peer.id)
      return
    }
    if (frame.type === 'spawn-result') {
      const f = frame as SpawnResultFrame
      resolveSpawnIntent(f.intent_id, {
        ok: f.ok,
        agentEmail: f.agent_email,
        error: f.error,
      })
    }
    // Unknown frame types get silently dropped — keeps the loop
    // forward-compatible when a newer nest sends a frame the troop
    // doesn't recognise yet.
  },

  close(peer) {
    authByPeerId.delete(peer.id)
    unregisterNestPeerById(peer.id)
  },
})
