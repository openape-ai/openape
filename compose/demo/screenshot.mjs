// Drives the local-stack flows in a real headless Chromium (joined to the
// openape-test docker network, so https://*.openape.test resolves + the Caddy
// cert is reachable) and writes a screenshot per step to /demo/out.
//
//   Flow 1: register a passkey at the IdP (via the self-service registration link)
//   Flow 2: DDISA SSO login into troop
//   Flow 3: one-click SSO into chat (same passkey + session)
//
// A CDP virtual authenticator satisfies the WebAuthn ceremony headlessly; it
// persists across the context, so flows 2-3 reuse the flow-1 passkey + session.
//
// REG_TOKEN (a self-service registration token, minted + read from the IdP DB by
// run.sh, standing in for the email link) is required for flow 1.

import { mkdirSync } from 'node:fs'
import { chromium } from 'playwright'

const OUT = '/demo/out'
mkdirSync(OUT, { recursive: true })

const EMAIL = 'demo@openape.test'
const IDP = 'https://id.openape.test'
const TROOP = 'https://troop.openape.test'
const CHAT = 'https://chat.openape.test'
const REG_TOKEN = process.env.REG_TOKEN || ''

let step = 0
async function shot(page, name) {
  step += 1
  const file = `${OUT}/${String(step).padStart(2, '0')}-${name}.png`
  await page.screenshot({ path: file }).catch(e => console.log(`[shot fail] ${name}: ${e.message}`))
  console.log(`[shot ${String(step).padStart(2, '0')}] ${name}  @ ${page.url()}`)
}

async function describe(page, label) {
  const map = await page.evaluate(() => {
    const seen = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 }
    const pick = sel => [...document.querySelectorAll(sel)].filter(seen).map(e => ({
      tag: e.tagName.toLowerCase(), type: e.getAttribute('type'),
      text: (e.innerText || e.value || '').trim().slice(0, 50),
    }))
    return { url: location.href, inputs: pick('input'), buttons: pick('button, a, [role=button]').filter(b => b.text) }
  }).catch(() => ({}))
  console.log(`[ui ${label}] ${JSON.stringify(map)}`)
}

async function click(page, re, { timeout = 12000, optional = false } = {}) {
  const el = page.getByRole('button', { name: re }).or(page.getByRole('link', { name: re })).first()
  try { await el.waitFor({ state: 'visible', timeout }); await el.click(); return true }
  catch (e) { if (optional) return false; throw e }
}

async function fillEmail(page, email, { optional = false } = {}) {
  const input = page.locator('input[type=email], input[placeholder*="@"]').first()
  try { await input.waitFor({ state: 'visible', timeout: 10000 }); await input.fill(email); return true }
  catch (e) { if (optional) return false; throw e }
}

const browser = await chromium.launch({ args: ['--ignore-certificate-errors'] })
const context = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1280, height: 860 } })
const page = await context.newPage()
page.on('console', m => { if (m.type() === 'error') console.log(`[console.error] ${m.text()}`) })
page.on('pageerror', e => console.log(`[pageerror] ${e.message}`))
page.on('response', async (r) => {
  if (r.status() >= 400 && /\/api\//.test(r.url()) && !/\/api\/me|\/ws-token/.test(r.url()))
    console.log(`[http ${r.status()}] ${r.request().method()} ${r.url().slice(0, 80)}`)
})

const client = await context.newCDPSession(page)
await client.send('WebAuthn.enable')
const { authenticatorId } = await client.send('WebAuthn.addVirtualAuthenticator', {
  options: {
    protocol: 'ctap2', transport: 'internal', hasResidentKey: true,
    hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true,
  },
})
console.log(`[webauthn] virtual authenticator ${authenticatorId}`)

async function flow(label, fn) {
  console.log(`\n=== ${label} ===`)
  try { await fn() }
  catch (e) {
    console.log(`[FLOW FAIL] ${label}: ${e.message.split('\n')[0]}`)
    await shot(page, `FAIL-${label.replace(/\W+/g, '-')}`)
    await describe(page, `fail-${label}`)
  }
}

// After the SP redirect the browser may pass through the IdP's /login (passkey
// assertion) and/or /consent (approve the SP) pages before bouncing back. Walk
// up to a few hops: on /login click "Sign in with Passkey" (the virtual
// authenticator answers), on /consent click "Anmelden" (NOT "Abbrechen").
async function approveIfPrompted(page) {
  for (let hop = 0; hop < 4; hop++) {
    await page.waitForLoadState('networkidle').catch(() => {})
    await page.waitForTimeout(1300) // let the Vue page hydrate before clicking
    const url = page.url()
    let did = false
    if (/\/login/.test(url))
      did = await click(page, /sign in with passkey/i, { optional: true, timeout: 8000 })
    else if (/\/consent|\/authorize/.test(url))
      did = await click(page, /^\s*anmelden\s*$|authorize|approve|zustimmen|bestätigen|erlauben/i, { optional: true, timeout: 8000 })
    else break
    console.log(`[approve hop ${hop}] ${url.slice(0, 60)} → clicked=${did}`)
    if (!did) break
    await page.waitForTimeout(1500)
  }
}

// ---- Flow 1: register a passkey at the IdP ----
await flow('Flow 1 — register a passkey at the IdP', async () => {
  await page.goto(IDP, { waitUntil: 'networkidle' })
  await shot(page, 'idp-landing')
  await click(page, /create account/i)
  await page.waitForTimeout(1000)
  await fillEmail(page, EMAIL, { optional: true })
  await shot(page, 'idp-request-link')
  // Open the registration link (run.sh minted the token + read it from the DB).
  if (!REG_TOKEN) throw new Error('REG_TOKEN not set — run via compose/demo/run.sh')
  await page.goto(`${IDP}/register?token=${REG_TOKEN}`, { waitUntil: 'networkidle' })
  await shot(page, 'idp-register-passkey')
  await describe(page, 'idp-register-passkey')
  await click(page, /create|register|passkey|continue|add|finish|sign up/i)
  await page.waitForTimeout(3500)
  await approveIfPrompted(page)
  await shot(page, 'idp-registered')
  await describe(page, 'idp-registered')
})

// ---- Flow 2: DDISA SSO login into troop ----
await flow('Flow 2 — DDISA SSO into troop', async () => {
  await page.goto(TROOP, { waitUntil: 'networkidle' })
  await shot(page, 'troop-landing')
  await fillEmail(page, EMAIL)
  await click(page, /sign in with openape|sign in|login|anmelden/i)
  await page.waitForURL(/id\.openape\.test/, { timeout: 20000 }).catch(() => {})
  await page.waitForTimeout(1500)
  await shot(page, 'idp-authorize-troop')
  await describe(page, 'idp-authorize-troop')
  await approveIfPrompted(page)
  await page.waitForURL(/troop\.openape\.test/, { timeout: 20000 }).catch(() => {})
  await page.waitForTimeout(2500)
  await shot(page, 'troop-dashboard')
  await describe(page, 'troop-dashboard')
})

// ---- Flow 3: one-click SSO into chat ----
await flow('Flow 3 — one-click SSO into chat', async () => {
  await page.goto(CHAT, { waitUntil: 'networkidle' })
  await shot(page, 'chat-landing')
  await fillEmail(page, EMAIL)
  await click(page, /sign in with openape|sign in|login|anmelden/i)
  await page.waitForTimeout(2500)
  await approveIfPrompted(page)
  await page.waitForURL(/chat\.openape\.test/, { timeout: 20000 }).catch(() => {})
  await page.waitForTimeout(2500)
  await shot(page, 'chat-dashboard')
  await describe(page, 'chat-dashboard')
})

console.log(`\n[done] ${step} screenshots in ${OUT}`)
await browser.close()
