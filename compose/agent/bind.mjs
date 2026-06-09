// Step 1 of the agent-lifecycle test: log in as the demo owner (passkey),
// bind a nest (capturing the one-time device_secret), and provision an owner
// `apes login` token so the nest can register agents at the IdP on spawn.
//
// Runs in the playwright container (browser + virtual authenticator, on the
// openape-test network). Writes:
//   /out/creds.json       {host_id, device_secret}  — nest ↔ troop bind
//   /out/troop-state.json storageState               — owner session for lifecycle
//   /out/apes-auth.json   {idp, access_token, …}     — owner login for the nest
//
// The apes-auth.json is the same shape `apes login` writes on a real Mac nest:
// `apes agents spawn` reads it (loadAuth) to enrol the new agent at the IdP.
// We mint it by driving the apes-cli PKCE flow in the already-authenticated
// browser context — exactly what a human does running `apes login` locally.
//
// REG_TOKEN (a registration token minted + read from the IdP DB by run.sh) is
// required.

import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { chromium } from 'playwright'

const OUT = '/out'
mkdirSync(OUT, { recursive: true })

const EMAIL = 'demo@openape.test'
const IDP = 'https://id.openape.test'
const TROOP = 'https://troop.openape.test'
const REG_TOKEN = process.env.REG_TOKEN || ''
if (!REG_TOKEN) throw new Error('REG_TOKEN not set — run via compose/agent/run.sh')

async function click(page, re, { timeout = 12000, optional = false } = {}) {
  const el = page.getByRole('button', { name: re }).or(page.getByRole('link', { name: re })).first()
  try { await el.waitFor({ state: 'visible', timeout }); await el.click(); return true }
  catch (e) { if (optional) return false; throw e }
}
async function fillEmail(page, email) {
  const input = page.locator('input[type=email], input[placeholder*="@"]').first()
  await input.waitFor({ state: 'visible', timeout: 10000 })
  await input.fill(email)
}
async function approve(page) {
  for (let hop = 0; hop < 4; hop++) {
    await page.waitForLoadState('networkidle').catch(() => {})
    await page.waitForTimeout(1300)
    const url = page.url()
    if (/\/login/.test(url)) { if (!await click(page, /sign in with passkey/i, { optional: true })) break }
    else if (/\/consent|\/authorize/.test(url)) { if (!await click(page, /^\s*anmelden\s*$|authorize|approve/i, { optional: true })) break }
    else break
    await page.waitForTimeout(1500)
  }
}

const browser = await chromium.launch({ args: ['--ignore-certificate-errors'] })
const context = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1280, height: 860 } })
const page = await context.newPage()
const client = await context.newCDPSession(page)
await client.send('WebAuthn.enable')
await client.send('WebAuthn.addVirtualAuthenticator', {
  options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true },
})

// Register a passkey for the demo owner.
await page.goto(`${IDP}/register?token=${REG_TOKEN}`, { waitUntil: 'networkidle' })
await click(page, /register passkey|register|create|continue/i)
await page.waitForTimeout(3000)

// Log into troop (DDISA SSO) so we hold an owner session.
await page.goto(TROOP, { waitUntil: 'networkidle' })
await fillEmail(page, EMAIL)
await click(page, /sign in with openape|sign in|login/i)
await approve(page)
await page.waitForURL(/troop\.openape\.test/, { timeout: 20000 }).catch(() => {})
await page.waitForTimeout(1500)
console.log(`[bind] logged in, at ${page.url()}`)

// Bind a nest as this owner — same-origin request carries the troop session.
const res = await context.request.post(`${TROOP}/api/nests/bind`, {
  data: { display_name: 'local-nest' },
  headers: { 'content-type': 'application/json' },
})
const body = await res.json().catch(() => ({}))
console.log(`[bind] POST /api/nests/bind → ${res.status()} ${JSON.stringify(body).slice(0, 200)}`)
if (!res.ok() || !body.host_id) throw new Error(`bind failed: ${res.status()} ${JSON.stringify(body)}`)

writeFileSync(`${OUT}/creds.json`, JSON.stringify({ host_id: body.host_id, device_secret: body.device_secret }))
await context.storageState({ path: `${OUT}/troop-state.json` })
console.log(`[bind] wrote creds + storageState. host_id=${body.host_id} secret=${body.device_secret ? 'present' : 'MISSING'}`)

// --- Provision an owner `apes login` for the nest (apes-cli PKCE) ---------
// Same authorization-code + PKCE dance apes/commands/auth/login.ts runs; the
// browser already holds an id.openape.test session from the troop SSO hop, so
// /authorize redirects straight through consent. We intercept the loopback
// redirect to read the code (nothing listens on :9876 in-container), then
// exchange it for a token at /token.
const b64url = buf => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const codeVerifier = b64url(randomBytes(32))
const codeChallenge = b64url(createHash('sha256').update(codeVerifier).digest())
const redirectUri = 'http://localhost:9876/callback'

let resolveCode, rejectCode
const codePromise = new Promise((res, rej) => { resolveCode = res; rejectCode = rej })
await context.route('http://localhost:9876/**', async (route) => {
  const u = new URL(route.request().url())
  await route.fulfill({ status: 200, contentType: 'text/html', body: '<h1>ok</h1>' }).catch(() => {})
  const code = u.searchParams.get('code')
  const err = u.searchParams.get('error')
  if (code) resolveCode(code)
  else if (err) rejectCode(new Error(`authorize error: ${err}`))
})

const authUrl = new URL(`${IDP}/authorize`)
authUrl.searchParams.set('response_type', 'code')
authUrl.searchParams.set('client_id', 'apes-cli')
authUrl.searchParams.set('redirect_uri', redirectUri)
authUrl.searchParams.set('code_challenge', codeChallenge)
authUrl.searchParams.set('code_challenge_method', 'S256')
authUrl.searchParams.set('state', randomUUID())
authUrl.searchParams.set('nonce', randomUUID())
authUrl.searchParams.set('scope', 'openid email profile offline_access')
await page.goto(authUrl.toString(), { waitUntil: 'commit' }).catch(() => {})
await approve(page) // click consent ("Anmelden") if the apes-cli grant needs it

const code = await Promise.race([
  codePromise,
  new Promise((_, rej) => setTimeout(() => rej(new Error('PKCE code capture timed out')), 30000)),
])
const tokenRes = await context.request.post(`${IDP}/token`, {
  headers: { 'content-type': 'application/json' },
  data: { grant_type: 'authorization_code', code, code_verifier: codeVerifier, redirect_uri: redirectUri, client_id: 'apes-cli' },
})
const tokens = await tokenRes.json().catch(() => ({}))
const accessToken = tokens.access_token || tokens.id_token || tokens.assertion
if (!tokenRes.ok() || !accessToken) throw new Error(`token exchange failed: ${tokenRes.status()} ${JSON.stringify(tokens).slice(0, 200)}`)
const claims = JSON.parse(Buffer.from(accessToken.split('.')[1], 'base64').toString('utf8'))
writeFileSync(`${OUT}/apes-auth.json`, `${JSON.stringify({
  idp: IDP,
  access_token: accessToken,
  ...(tokens.refresh_token ? { refresh_token: tokens.refresh_token } : {}),
  email: claims.email || claims.sub || EMAIL,
  expires_at: Math.floor(Date.now() / 1000) + (tokens.expires_in || 300),
}, null, 2)}\n`)
console.log(`[bind] wrote apes-auth.json — owner login as ${claims.email || claims.sub} (act=${claims.act}, refresh=${tokens.refresh_token ? 'yes' : 'no'})`)

await browser.close()
