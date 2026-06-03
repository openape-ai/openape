import { createRemoteJWKS, verifyJWT } from '@openape/core'
import { and, eq } from 'drizzle-orm'
import { useRuntimeConfig } from 'nitropack/runtime'
import toolCatalog from '../../tool-catalog.json'
import { useDb } from '../../database/drizzle'
import { agents, nests, tasks } from '../../database/schema'
import { parseAgentEmail } from '../../utils/agent-email'
import { verifyCliToken } from '../../utils/cli-token'
import { resolveDestroyIntent } from '../../utils/destroy-intents'
import { parseNestDeviceToken } from '../../utils/nest-credential'
import { registerNestPeer, touchNestPeer, unregisterNestPeerById } from '../../utils/nest-registry'
import { takeRecipeDeploy } from '../../utils/recipe-deploys'
import { resolveSpawnIntent } from '../../utils/spawn-intents'

const ALL_TOOL_NAMES: string[] = (toolCatalog as { tools: Array<{ name: string }> }).tools.map(t => t.name)

// Control-plane WS for local nest daemons. Each connected peer
// represents a Mac (or any host) running `openape-nest`, owned by
// the DDISA-authenticated `sub` of the bearer token used at upgrade.
//
// Frames in (nest → troop):
//   - hello { host_id, hostname, version }   — must be the first message
//   - heartbeat                              — bumps lastSeenAt, no reply
//   - spawn-result { intent_id, ok, agent_email?, error? }
//   - destroy-result { intent_id, ok, name, error? }
//
// Frames out (troop → nest):
//   - config-update { agent_email }          — nest re-syncs the named agent
//   - spawn-intent { intent_id, name, bridge?, skills? }
//   - destroy-intent { intent_id, name }     — `apes agents destroy --force`
//   - reload-bridge { name }                 — pm2 reload, no fresh sync
//
// Auth model: three flavours of caller.
//
//   - **troop device token** (M4δ — the nest-as-device path). A
//     troop-issued HS256 CLI token with act='agent' and
//     delegate='nest:<host_id>'. The keypair-less pod mints it from its
//     bind-time device secret at POST /api/nests/token. We verify it with
//     troop's own secret (verifyCliToken), pull (ownerEmail, host_id) off
//     the token, and require an *active* nests row — so revoking the nest
//     (status='revoked') drops the connection at the next (re)connect. The
//     host_id is token-authoritative; we ignore the self-reported one.
//   - `act: human` — owner-direct connection (UI/dev tooling), IdP-signed.
//     ownerEmail = JWT `sub`.
//   - `act: agent` (IdP-signed) — the legacy keypair nest. The agent email
//     encodes its owner (`<name>-<hash>+<owner-local>+<owner-domain>@id…`),
//     so we resolve ownerEmail from parseAgentEmail. Kept until the live
//     nests are cut over to device identity.
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

interface AuthCtx {
  ownerEmail: string
  /** Set only for device-token nests — the token-authoritative host_id. */
  hostId?: string
}
const authByPeerId = new Map<string, AuthCtx>()

async function authenticateUpgrade(token: string): Promise<AuthCtx> {
  // Device-token path first: a troop-issued HS256 token verifies cheaply
  // and fails fast (verifyCliToken → null) for any IdP-signed token, so
  // legacy nests fall straight through to the JWKS path below.
  const device = parseNestDeviceToken(await verifyCliToken(token))
  if (device) {
    const db = useDb()
    const rows = await db
      .select({ hostId: nests.hostId })
      .from(nests)
      .where(and(
        eq(nests.ownerEmail, device.ownerEmail),
        eq(nests.hostId, device.hostId),
        eq(nests.status, 'active'),
      ))
      .limit(1)
    if (!rows[0]) throw new Error('nest is revoked or unknown')
    return { ownerEmail: device.ownerEmail, hostId: device.hostId }
  }

  const { payload } = await verifyJWT<DDISAClaims>(token, jwks())
  if (!payload.sub) throw new Error('token missing sub')
  if (payload.act === 'human') {
    return { ownerEmail: payload.sub.toLowerCase() }
  }
  // REMOVE-AFTER: cutover-verified (see MIGRATION-mac-to-docker.md)
  // Legacy keypair nest path: agent JWT with act=agent encodes ownerEmail in
  // the sub. Kept until we confirm no live nest still uses keypair auth
  // (troop prod DB: nests with null device_secret_hash = legacy). After
  // cutover: remove this branch and parseAgentEmail import.
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
interface DestroyResultFrame {
  type: 'destroy-result'
  intent_id: string
  ok: boolean
  /**
   * Agent name we asked the nest to destroy — echoed back so we
   *  can drop the row from the troop DB without re-reading the
   *  intent payload.
   */
  name: string
  error?: string
}
type InboundFrame = HelloFrame | HeartbeatFrame | SpawnResultFrame | DestroyResultFrame | { type: string }

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
      // Device-token nests: the host_id is bound into the token, so trust
      // that over the self-reported one (no more host fingerprinting).
      const hostId = ctx.hostId ?? f.host_id
      if (!hostId || !f.hostname) return
      registerNestPeer({
        ownerEmail: ctx.ownerEmail,
        hostId,
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
      // Pre-insert a stub row in the agents table so the troop UI's
      // refresh on dialog-close picks up the new agent immediately.
      // Without this there's a race: spawn-result arrives before the
      // bridge has booted + done its first /api/agents/me/sync, so
      // the UI refresh hits an empty list and the user has to bounce
      // through another agent's detail page to trigger a re-fetch.
      //
      // The bridge's first-sync handler does an INSERT-or-UPDATE
      // keyed on `email`, so our stub here gets enriched with
      // host_id / hostname / pubkey on the next sync (~5s after
      // spawn completes). We seed `tools` to the full catalog —
      // identical default as sync.post.ts uses for first-time rows.
      if (f.ok && f.agent_email) {
        const parsed = parseAgentEmail(f.agent_email)
        if (parsed && parsed.ownerEmail.toLowerCase() === ctx.ownerEmail.toLowerCase()) {
          const db = useDb()
          const now = Math.floor(Date.now() / 1000)
          const agentEmail = f.agent_email
          void Promise.resolve(
            db.insert(agents).values({
              email: agentEmail,
              ownerEmail: ctx.ownerEmail.toLowerCase(),
              agentName: parsed.agentName,
              hostId: null,
              hostname: null,
              pubkeySsh: null,
              tools: ALL_TOOL_NAMES,
              firstSeenAt: null,
              lastSeenAt: null,
              createdAt: now,
            }).onConflictDoNothing(),
          ).catch(() => { /* ignore — bridge sync will retry the upsert */ })

          // Agent Recipe (M3): if this spawn came from a recipe-deploy,
          // apply the stashed plan — set the agent's system prompt to
          // the materialized intent and create the schedule task rows.
          // Capability secrets are bound separately by the owner (M2c).
          const deploy = takeRecipeDeploy(f.intent_id)
          if (deploy) {
            const plan = deploy.plan
            void Promise.resolve(
              (async () => {
                await db.update(agents)
                  .set({
                    systemPrompt: plan.systemPrompt,
                    ...(plan.userAddendum !== undefined ? { userAddendum: plan.userAddendum } : {}),
                  })
                  .where(eq(agents.email, agentEmail))
                for (const s of plan.schedules) {
                  await db.insert(tasks).values({
                    agentEmail,
                    taskId: s.taskId,
                    name: s.name,
                    cron: s.cron,
                    userPrompt: s.userPrompt,
                    command: s.command ?? null,
                    tools: s.tools,
                    maxSteps: 10,
                    enabled: true,
                    createdAt: now,
                    updatedAt: now,
                  }).onConflictDoUpdate({
                    target: [tasks.agentEmail, tasks.taskId],
                    set: { name: s.name, cron: s.cron, userPrompt: s.userPrompt, command: s.command ?? null, tools: s.tools, updatedAt: now },
                  })
                }
              })(),
            ).catch(() => { /* best-effort — owner can re-deploy */ })
          }
        }
      }
      return
    }
    if (frame.type === 'destroy-result') {
      const f = frame as DestroyResultFrame
      resolveDestroyIntent(f.intent_id, { ok: f.ok, error: f.error })
      // On success, clear the troop-side DB row so the agent
      // disappears from `/agents`. Best-effort — the auth ctx
      // gives us the owner, and the row is scoped to that owner +
      // name so we never affect another tenant. If the row is
      // already gone (legacy agent never synced to troop), the
      // delete is a no-op.
      if (f.ok && f.name) {
        const db = useDb()
        const ownerEmail = ctx.ownerEmail.toLowerCase()
        const name = f.name
        void Promise.resolve(
          db.delete(agents).where(and(eq(agents.ownerEmail, ownerEmail), eq(agents.agentName, name))),
        ).catch(() => { /* ignore — orphaned UI is harmless */ })
      }

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
