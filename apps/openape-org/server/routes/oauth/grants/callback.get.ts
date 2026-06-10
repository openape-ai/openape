import { eq } from 'drizzle-orm'
import { useRuntimeConfig } from 'nitropack/runtime'
import { useDb } from '../../../database/drizzle'
import { organizations } from '../../../database/schema'
import { spawnMemberViaTroop } from '../../../utils/spawn-member'

interface CrossSpSpawnCtx {
  codeVerifier: string
  state: string
  memberEmail: string
  orgId: string
  redirectUri: string
}

// GET /oauth/grants/callback
//
// The IdP redirects the Owner here with ?code=&state= after they approve (or
// already have) the cross-SP delegation. We redeem the code server-to-server
// for the delegation AuthZ-JWT (no browser token, no CORS), then run the spawn
// and bounce back to the org page where the UI polls for the agent.
export default defineEventHandler(async (event) => {
  const session = await getSpSession(event)
  const ctx = (session.data as { crossSpSpawn?: CrossSpSpawnCtx }).crossSpSpawn
  const query = getQuery(event)
  const origin = getRequestURL(event).origin

  const back = (extra: Record<string, string>) => {
    const url = new URL(`/orgs/${ctx?.orgId ?? ''}`, origin)
    for (const [k, v] of Object.entries(extra)) url.searchParams.set(k, v)
    return sendRedirect(event, url.pathname + url.search)
  }

  // One-shot: clear the stashed context regardless of outcome.
  await session.update({ crossSpSpawn: undefined })

  if (!ctx) return sendRedirect(event, '/')
  if (query.error) return back({ spawn_error: String(query.error_description ?? query.error) })
  if (String(query.state ?? '') !== ctx.state) return back({ spawn_error: 'state mismatch — please retry' })
  const code = String(query.code ?? '')
  if (!code) return back({ spawn_error: 'missing authorization code' })

  const config = useRuntimeConfig()
  const idpUrl = (config.public as { idpUrl?: string }).idpUrl as string
  const clientId = config.openapeSp.clientId as string

  let authzJwt: string
  try {
    const r = await $fetch<{ authz_jwt: string }>(`${idpUrl}/api/grants/cross-sp-token`, {
      method: 'POST',
      body: { code, code_verifier: ctx.codeVerifier, redirect_uri: ctx.redirectUri, client_id: clientId },
    })
    authzJwt = r.authz_jwt
  }
  catch (err: any) {
    return back({ spawn_error: `code exchange failed: ${err?.data?.detail ?? err?.data?.title ?? err?.message ?? 'unknown'}` })
  }

  // Re-verify the current Owner owns the org before spawning (defence in depth
  // — the AuthZ-JWT already binds to the consenting Owner, but the org row is
  // the authority for ownership).
  const owner = (session.data as { claims?: { sub?: string } }).claims?.sub
  const db = useDb()
  const rows = await db.select().from(organizations).where(eq(organizations.id, ctx.orgId)).limit(1)
  const org = rows[0]
  if (!org) return back({ spawn_error: 'organization not found' })
  if (!owner || org.ownerEmail.toLowerCase() !== owner.toLowerCase()) {
    return back({ spawn_error: 'not your organization' })
  }

  try {
    await spawnMemberViaTroop({ id: org.id, name: org.name }, ctx.memberEmail, authzJwt)
  }
  catch (err: any) {
    return back({ spawn_error: err?.statusMessage ?? err?.message ?? 'spawn failed' })
  }
  return back({ spawned: ctx.memberEmail })
})
