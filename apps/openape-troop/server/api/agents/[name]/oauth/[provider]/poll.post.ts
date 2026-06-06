import { and, eq } from 'drizzle-orm'
import { useDb } from '../../../../../database/drizzle'
import { agents, agentSecrets, oauthCredentials } from '../../../../../database/schema'
import { buildSecretUpdateFrame, sealSecret, serializeSealed } from '../../../../../utils/agent-secrets'
import { requireOwner } from '../../../../../utils/auth'
import { broadcastToOwner } from '../../../../../utils/nest-registry'
import { CHATGPT_AUTH_FILE_PATH, CHATGPT_SECRET_ENV, pollChatgptToken, toCodexAuthJson } from '../../../../../utils/oauth-chatgpt'

// Poll the device flow once. On `pending`/`slow_down` the UI keeps polling.
// On success: serialize the token → seal the auth.json to the agent's X25519
// pubkey → persist as a file-target agent_secret (CHATGPT_AUTH_JSON) and push
// it over the nest WS. The agent's broker (M1/S1) writes it to the codex-proxy
// auth.json with seed-once; the in-nest codex-proxy refreshes it in place.
export default defineEventHandler(async (event) => {
  const owner = await requireOwner(event)
  const name = getRouterParam(event, 'name')
  const provider = getRouterParam(event, 'provider')
  if (!name || !provider) throw createError({ statusCode: 400, statusMessage: 'name and provider are required' })
  if (provider !== 'chatgpt') throw createError({ statusCode: 400, statusMessage: 'unsupported provider' })

  const db = useDb()
  const agent = await db
    .select({ email: agents.email, pubkeyX25519: agents.pubkeyX25519 })
    .from(agents)
    .where(and(eq(agents.ownerEmail, owner.toLowerCase()), eq(agents.agentName, name)))
    .get()
  if (!agent) throw createError({ statusCode: 404, statusMessage: 'agent not found' })

  const cred = await db
    .select()
    .from(oauthCredentials)
    .where(and(eq(oauthCredentials.agentEmail, agent.email), eq(oauthCredentials.provider, provider)))
    .get()
  if (!cred?.deviceCode) throw createError({ statusCode: 409, statusMessage: 'no device flow in progress — call initiate first' })

  setHeader(event, 'Cache-Control', 'no-store')
  const now = Math.floor(Date.now() / 1000)

  let result
  try {
    result = await pollChatgptToken(globalThis.fetch, cred.deviceCode)
  }
  catch (e) {
    throw createError({ statusCode: 502, statusMessage: `token poll failed: ${(e as Error).message}` })
  }

  if (result.status === 'denied') {
    await db.update(oauthCredentials).set({ status: 'denied', deviceCode: null, updatedAt: now }).where(and(eq(oauthCredentials.agentEmail, agent.email), eq(oauthCredentials.provider, provider)))
    return { status: 'denied', error: result.error }
  }
  if (result.status !== 'token') {
    return { status: result.status } // pending | slow_down
  }

  const auth = toCodexAuthJson(result.token)
  let box
  try {
    box = sealSecret(agent.pubkeyX25519, JSON.stringify(auth))
  }
  catch (e) {
    throw createError({ statusCode: 409, statusMessage: (e as Error).message })
  }
  // Carry the file target in the sealed blob so S1's broker writes a file
  // (not an env var). buildSecretUpdateFrame serializes the same blob.
  const fileBox = { ...box, materializeTo: CHATGPT_AUTH_FILE_PATH }
  const sealed = serializeSealed(fileBox)

  const existingSecret = await db
    .select({ env: agentSecrets.env })
    .from(agentSecrets)
    .where(and(eq(agentSecrets.agentEmail, agent.email), eq(agentSecrets.env, CHATGPT_SECRET_ENV)))
    .get()
  if (existingSecret) {
    await db.update(agentSecrets).set({ sealed, updatedAt: now, revokedAt: null }).where(and(eq(agentSecrets.agentEmail, agent.email), eq(agentSecrets.env, CHATGPT_SECRET_ENV)))
  }
  else {
    await db.insert(agentSecrets).values({ agentEmail: agent.email, env: CHATGPT_SECRET_ENV, sealed, createdAt: now, updatedAt: now, revokedAt: null })
  }

  await db.update(oauthCredentials)
    .set({ status: 'connected', deviceCode: null, accountId: auth.account_id, expiresAt: auth.expires_at, updatedAt: now })
    .where(and(eq(oauthCredentials.agentEmail, agent.email), eq(oauthCredentials.provider, provider)))

  broadcastToOwner(owner.toLowerCase(), buildSecretUpdateFrame(agent.email, CHATGPT_SECRET_ENV, fileBox) as unknown as Record<string, unknown>)

  return { status: 'connected', account_id: auth.account_id, expires_at: auth.expires_at }
})
