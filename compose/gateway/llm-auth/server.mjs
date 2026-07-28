// DDISA token-exchange front-end for the llms.openape.ai LLM gateway.
//
// One endpoint: POST /api/cli/exchange — an agent presents its IdP access
// token (EdDSA, iss=id.openape.ai, aud=apes-cli) and gets back a short-lived
// HS256 token scoped to aud=llms.openape.ai (RFC 8693, Option E). The gateway's
// LiteLLM custom_auth hook validates that HS256 token with the SAME shared
// SESSION_SECRET — so the agent never replays its IdP token at the gateway
// (least-privilege / audience-scoping). Mirrors @openape/nuxt-auth-sp's
// createCliExchangeHandler, standalone (single file, only `jose`).

import { createServer } from 'node:http'
import process from 'node:process'
import { createRemoteJWKSet, jwtVerify, SignJWT } from 'jose'

const PORT = Number(process.env.PORT || 4010)
const SP_AUD = process.env.SP_AUD || 'llms.openape.ai'
const IDP = process.env.IDP_URL || 'https://id.openape.ai'
const EXPECTED_AUD = 'apes-cli' // the aud DDISA mints on CLI/agent IdP tokens
const TTL = Number(process.env.TOKEN_TTL_SECONDS || 3600)

const secretRaw = process.env.SESSION_SECRET || ''
if (secretRaw.length < 32 && process.env.NODE_ENV !== 'test') {
  console.error('SESSION_SECRET must be >= 32 chars')
  process.exit(1)
}
const SECRET = new TextEncoder().encode(secretRaw)
const jwks = createRemoteJWKSet(new URL('/.well-known/jwks.json', IDP))

const LLM_ACCOUNT_RESOURCE = 'llm-account'

// Extract the LLM accounts an agent may use from its DDISA standing grants
// (M4). A standing grant for the gateway authorizes one account via
// resource_chain_template=[{resource:'llm-account', selector:{account:X}}].
// A missing selector / account '*' means "any account". Pure + tested.
export function accountsFromGrants(grants, aud) {
  const accounts = new Set()
  for (const g of Array.isArray(grants) ? grants : []) {
    if (g?.type !== 'standing' || g?.status !== 'approved') continue
    const req = g.request
    if (!req || req.audience !== aud || !Array.isArray(req.resource_chain_template)) continue
    for (const ref of req.resource_chain_template) {
      if (ref?.resource !== LLM_ACCOUNT_RESOURCE) continue
      const acct = ref.selector?.account
      accounts.add(acct && acct !== '*' ? acct : '*')
    }
  }
  return [...accounts]
}

// Fetch the agent's own grants from the IdP using its (already-verified) IdP
// token, and reduce to the allowed LLM accounts. Fail-closed: any error -> [].
async function resolveAccounts(subjectToken) {
  try {
    const res = await fetch(`${IDP}/api/grants?status=approved&limit=100`, {
      headers: { authorization: `Bearer ${subjectToken}` },
    })
    if (!res.ok) {
      console.error(`grants lookup ${res.status} — issuing token with no accounts`)
      return []
    }
    const body = await res.json()
    return accountsFromGrants(body?.data ?? body, SP_AUD)
  }
  catch (e) {
    console.error(`grants lookup failed — issuing token with no accounts: ${e?.message ?? e}`)
    return []
  }
}

function sendJson(res, code, body) {
  res.writeHead(code, { 'content-type': 'application/json' })
  res.end(JSON.stringify(body))
}

const server = createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/health') return sendJson(res, 200, { ok: true })
  if (req.method !== 'POST' || req.url !== '/api/cli/exchange') return sendJson(res, 404, { error: 'not found' })

  let body = ''
  req.on('data', (c) => {
    body += c
    if (body.length > 100_000) req.destroy()
  })
  req.on('end', async () => {
    let parsed
    try { parsed = JSON.parse(body) }
    catch { return sendJson(res, 400, { error: 'invalid json' }) }

    const subjectToken = parsed?.subject_token
    if (typeof subjectToken !== 'string' || subjectToken.length === 0) {
      return sendJson(res, 400, { error: 'subject_token is required' })
    }

    let claims
    try {
      const { payload } = await jwtVerify(subjectToken, jwks, { issuer: IDP, audience: EXPECTED_AUD })
      claims = payload
    }
    catch (e) {
      return sendJson(res, 401, { error: `invalid subject_token: ${(e).message}` })
    }

    const sub = claims.sub
    if (typeof sub !== 'string' || !sub.includes('@')) {
      return sendJson(res, 401, { error: 'subject_token sub must be an email' })
    }
    const act = claims.act === 'agent' ? 'agent' : 'human'

    // M4: reflect the agent's owner-issued LLM-account grants into the token.
    const accounts = await resolveAccounts(subjectToken)

    const now = Math.floor(Date.now() / 1000)
    const exp = now + TTL
    const token = await new SignJWT({ typ: 'cli', sub, email: sub, act, accounts })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuer(SP_AUD)
      .setAudience(SP_AUD)
      .setIssuedAt()
      .setExpirationTime(exp)
      .sign(SECRET)

    sendJson(res, 201, { access_token: token, token_type: 'Bearer', expires_in: TTL, expires_at: exp, aud: SP_AUD, accounts })
  })
})

if (process.env.NODE_ENV !== 'test') {
  server.listen(PORT, '0.0.0.0', () => console.log(`llm-auth exchange listening on :${PORT} (sp_aud=${SP_AUD}, idp=${IDP})`))
}
