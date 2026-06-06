import { and, eq } from 'drizzle-orm'
import { useDb } from '../../../../../database/drizzle'
import { agents, oauthCredentials } from '../../../../../database/schema'
import { requireOwner } from '../../../../../utils/auth'
import { initiateChatgptDeviceFlow } from '../../../../../utils/oauth-chatgpt'

// Start the "Sign in with ChatGPT" device flow for an agent. Returns the
// user_code + verification URI the owner enters in a browser; the device_code
// is kept server-side (oauth_credentials) so /poll completes without ever
// exposing it to the browser.
export default defineEventHandler(async (event) => {
  const owner = await requireOwner(event)
  const name = getRouterParam(event, 'name')
  const provider = getRouterParam(event, 'provider')
  if (!name || !provider) throw createError({ statusCode: 400, statusMessage: 'name and provider are required' })
  if (provider !== 'chatgpt') throw createError({ statusCode: 400, statusMessage: 'unsupported provider' })

  const db = useDb()
  const agent = await db
    .select({ email: agents.email })
    .from(agents)
    .where(and(eq(agents.ownerEmail, owner.toLowerCase()), eq(agents.agentName, name)))
    .get()
  if (!agent) throw createError({ statusCode: 404, statusMessage: 'agent not found' })

  let start
  try {
    start = await initiateChatgptDeviceFlow(globalThis.fetch)
  }
  catch (e) {
    throw createError({ statusCode: 502, statusMessage: `device flow failed: ${(e as Error).message}` })
  }

  const now = Math.floor(Date.now() / 1000)
  const fields = {
    status: 'pending',
    deviceCode: start.device_code,
    userCode: start.user_code,
    verificationUri: start.verification_uri_complete ?? start.verification_uri,
    deviceExpiresAt: now + start.expires_in,
    accountId: null,
    expiresAt: null,
    updatedAt: now,
  }
  const existing = await db
    .select({ agentEmail: oauthCredentials.agentEmail })
    .from(oauthCredentials)
    .where(and(eq(oauthCredentials.agentEmail, agent.email), eq(oauthCredentials.provider, provider)))
    .get()
  if (existing) {
    await db.update(oauthCredentials).set(fields).where(and(eq(oauthCredentials.agentEmail, agent.email), eq(oauthCredentials.provider, provider)))
  }
  else {
    await db.insert(oauthCredentials).values({ agentEmail: agent.email, provider, createdAt: now, ...fields })
  }

  setHeader(event, 'Cache-Control', 'no-store')
  return {
    status: 'pending',
    user_code: start.user_code,
    verification_uri: fields.verificationUri,
    interval: start.interval,
    expires_in: start.expires_in,
  }
})
