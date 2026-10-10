import { generateKeyPairSync, randomBytes, randomUUID, sign } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { chromium } from 'playwright'
import type { Browser, BrowserContext, Page } from 'playwright'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { centralFixture, fullPublication } from '../../openape-pods/test/workspace/central-fixture'
import { keyObjectToSshString } from 'openape-e2e/constants'
import { startIdp } from 'openape-e2e/idp-fixture'
import { loginWithSshKey } from 'openape-e2e/key-auth'
import { makeTempDir, startServer } from 'openape-e2e/lifecycle'
import type { RunningServer } from 'openape-e2e/lifecycle'
import { challenge, generateKey, proofBytes, publicKey, signBytes, sha256 } from '@openape/pods-protocol/crypto'

// Installed-app acceptance for the mobile inbox (plan issue 1446, M4) on the built relay in a phone-sized Chrome.
// Everything signs in through real DDISA redirects; the desktop is a synthetic runtime that publishes and applies.
let idp: RunningServer; let relay: RunningServer; let browser: Browser
const managementToken = 'pods-inbox-app-fixture'
const owner = 'owner@pods-inbox.test'
const other = 'other@pods-inbox.test'
const shots = process.env.PODS_INBOX_SCREENSHOTS ?? makeTempDir('pods-inbox-shots-')
const keys = new Map<string, ReturnType<typeof generateKeyPairSync>>()

beforeAll(async () => {
  const built = spawnSync('pnpm', ['exec', 'nuxt', 'build'], { cwd: process.cwd(), encoding: 'utf8' })
  if (built.status !== 0) throw new Error(`nuxt build failed:\n${built.stdout}\n${built.stderr}`)
  // Four browser sign-ins plus the desktop exceed the IdP's ten logins per minute; the child inherits this limit.
  process.env.OPENAPE_RATE_LIMIT_MAX_AUTH = '100'
  idp = await startIdp({ managementToken, ddisaMockRecords: { 'pods-inbox.test': { version: 'ddisa1', idp: 'https://identity.example', mode: 'open' } } })
  relay = await startServer({
    cwd: process.cwd(), readyPath: '/api/health', timeoutMs: 300000, command: () => ['node', '.output/server/index.mjs'],
    env: ({ url, port }) => ({ PORT: String(port), HOST: '127.0.0.1', NUXT_WORKSPACE_ENABLED: 'true', NUXT_INBOX_ENABLED: 'true', NUXT_INBOX_DATABASE: `${makeTempDir('pods-inbox-app-')}/inbox.sqlite`, NUXT_WORKSPACE_DATABASE: `${makeTempDir('pods-inbox-app-')}/workspace.sqlite`, NUXT_WORKSPACE_SESSION_SECRET: 'synthetic-workspace-session-secret-1446', NUXT_OPENAPE_SP_SESSION_SECRET: 'synthetic-workspace-flow-secret-1446', NUXT_OPENAPE_SP_OPENAPE_URL: idp.url, NUXT_OPENAPE_SP_CLIENT_ID: new URL(url).host, NUXT_RELAY_ORIGIN: url, NUXT_RELAY_ENABLED: 'true', NUXT_RELAY_ENROLLMENT: 'pilot', NUXT_RELAY_OWNER_ALLOWLIST: JSON.stringify([owner, other].map(subject => ({ issuer: idp.url, subject }))), NUXT_RELAY_FIXTURE: 'true', NUXT_RELAY_IDP_URL: idp.url, NUXT_RELAY_DATABASE: `${makeTempDir('pods-inbox-app-')}/relay.sqlite` }),
  })
  for (const email of [owner, other]) {
    const pair = generateKeyPairSync('ed25519'); keys.set(email, pair)
    for (const [path, body] of [['/api/admin/users', { email, password: 'synthetic-pods-inbox-password-123', name: email }], [`/api/admin/users/${email}/ssh-keys`, { publicKey: keyObjectToSshString(pair.publicKey, email), name: 'Synthetic key' }]] as const) {
      const response = await fetch(`${idp.url}${path}`, { method: 'POST', headers: { authorization: `Bearer ${managementToken}`, 'content-type': 'application/json' }, body: JSON.stringify(body) })
      expect(response.status, await response.text()).toBe(200)
    }
  }
  browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' })
}, 600000)
afterAll(async () => { await browser?.close(); await relay?.stop(); await idp?.stop() })

// The synthetic desktop: a registered runtime with a published workspace that accepts and completes inbox commands.
async function desktop(email: string) {
  const pair = keys.get(email)!
  const ssh = keyObjectToSshString(pair.publicKey, email)
  const loginToken = await loginWithSshKey(idp.url, email, pair.privateKey, ssh)
  const key = generateKey(); const agreement = generateKey(); const deviceId = randomUUID(); const verifier = randomBytes(32).toString('base64url')
  const post = (path: string, body: unknown) => fetch(`${relay.url}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), redirect: 'manual' })
  const start = await (await post('/api/mobile/v1/session/begin', { deviceId, kind: 'runtime', keys: { signing: publicKey(key), agreement: publicKey(agreement) }, challenge: challenge(verifier), email })).json() as { id: string, browserUrl: string }
  const flow = await fetch(start.browserUrl, { redirect: 'manual' })
  const authorization = await fetch(flow.headers.get('location')!, { redirect: 'manual', headers: { authorization: `Bearer ${loginToken}` } })
  await fetch(authorization.headers.get('location')!, { redirect: 'manual', headers: { cookie: flow.headers.get('set-cookie')!.split(';')[0]! } })
  const exchanged = await post('/api/mobile/v1/session/exchange', { id: start.id, verifier, signature: signBytes(proofBytes('session-exchange', start.id, challenge(verifier)), key) })
  expect(exchanged.status, await exchanged.clone().text()).toBe(200)
  const { accessToken } = await exchanged.json() as { accessToken: string }
  async function send(path: string, body: unknown) {
    const encoded = JSON.stringify(body); const id = randomUUID(); const at = new Date().toISOString(); const digest = sha256(encoded)
    const proof = signBytes(proofBytes('api-request', id, JSON.stringify(['POST', path, sha256(accessToken), at, digest])), key)
    const response = await fetch(`${relay.url}${path}`, { method: 'POST', headers: { 'authorization': `Bearer ${accessToken}`, 'x-pods-request-id': id, 'x-pods-request-at': at, 'x-pods-body-digest': digest, 'x-pods-proof': proof, 'content-type': 'application/json' }, body: encoded })
    expect([200, 201], await response.clone().text()).toContain(response.status)
    return response.json()
  }
  const { lease } = await send('/api/runtime/v1/workspace', { type: 'begin' }) as { lease: string }
  const fixture = centralFixture()
  const publication = fullPublication({ version: 1, workspace: { ...fixture.host.workspace, pods: [fixture.host.workspace.pods[0]!] }, pods: [fixture.view], artifacts: [], blobs: [] })
  const publish = async (revision: number, completion?: unknown) => {
    await send('/api/runtime/v1/workspace', { type: 'parts', lease, parts: publication.parts })
    return send('/api/runtime/v1/workspace', { type: 'publish', format: 2, lease, id: randomUUID(), revision, changes: publication.changes, hash: publication.hash, ...(completion ? { completion } : {}) })
  }
  let revision = 0
  const published = await publish(revision) as { hash: string }
  await send('/api/runtime/v1/workspace', { type: 'heartbeat', lease, hash: published.hash })
  return {
    podId: fixture.view.id,
    message: (eventId: string, title: string, body: string, links: { title: string, url: string }[] = []) => send('/api/runtime/v1/inbox', { eventId, kind: 'message', title, body, podId: fixture.view.id, podName: 'Belege', links }),
    decisions: (decisions: unknown[]) => send('/api/runtime/v1/inbox/decisions', { decisions }),
    claim: () => send('/api/runtime/v1/workspace', { type: 'claim', lease }) as Promise<{ id: string, command: { body: Record<string, unknown> } } | null>,
    complete: (id: string) => publish(++revision, { id, result: { status: 'applied' }, error: null }),
  }
}

async function phone(email: string, storageState?: Awaited<ReturnType<BrowserContext['storageState']>>): Promise<{ context: BrowserContext, page: Page }> {
  const context = await browser.newContext({ viewport: { width: 375, height: 812 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'de-AT', storageState, serviceWorkers: 'allow' })
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'setAppBadge', { value: async (count: number) => { document.documentElement.dataset.appBadge = String(count) } })
    Object.defineProperty(navigator, 'clearAppBadge', { value: async () => { document.documentElement.dataset.appBadge = '0' } })
  })
  const page = await context.newPage()
  if (storageState) return { context, page }
  await page.goto(`${relay.url}/inbox/`)
  await signIn(page, email)
  return { context, page }
}
// An IdP browser session first (SSH key instead of a passkey), then the inbox's own sign-in form and redirects.
async function signIn(page: Page, email: string) {
  const pair = keys.get(email)!
  const request = page.context().request
  const { challenge: nonce } = await (await request.post(`${idp.url}/api/auth/challenge`, { data: { id: email } })).json() as { challenge: string }
  const session = await request.post(`${idp.url}/api/session/login`, { data: { id: email, challenge: nonce, signature: sign(null, Buffer.from(nonce), pair.privateKey).toString('base64'), public_key: keyObjectToSshString(pair.publicKey, email) } })
  expect(session.ok(), await session.text()).toBe(true)
  await page.getByLabel('E-Mail').fill(email)
  await page.getByRole('button', { name: 'Weiter mit OpenApe' }).click()
  // The form stays on the same URL, so wait for the signed-in tab bar after the redirects instead.
  try { await page.getByRole('link', { name: /Einstellungen/ }).waitFor({ timeout: 30000 }) }
  catch (error) { throw new Error(`Sign-in stuck at ${page.url()}: ${(await page.locator('body').textContent() ?? '').slice(0, 500)}`, { cause: error }) }
}
const shot = (page: Page, name: string) => page.screenshot({ path: join(shots, `${name}.png`), fullPage: true })
const noHorizontalScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)

it('decides, reads, survives restart and reinstall, works offline and never mixes accounts', async () => {
  mkdirSync(shots, { recursive: true })
  const mac = await desktop(owner)
  const digest = (seed: string) => sha256(seed)
  const effect = { sourceId: 'effect:mail-1', type: 'effect', digest: digest('effect-1'), podId: mac.podId, podName: 'Belege', title: 'Rechnung an Buchhaltung zustellen?', body: 'Die Zustellung der Rechnung R-2026-104 ist unklar.\nZustellen oder als bereits erledigt markieren.', authority: 'pods', options: [{ key: 'deliver', title: 'Erneut zustellen', input: null }, { key: 'seen', title: 'Bereits zugestellt', input: 'evidence' }], link: null }
  const idpGrant = { sourceId: 'approval:grant-1', type: 'approval', digest: digest('grant-1'), podId: mac.podId, podName: 'Belege', title: 'Zugriff auf mail.example freigeben', body: 'Der Pod möchte Mails lesen.', authority: 'idp', options: [], link: { title: 'In OpenApe ID freigeben', url: 'https://id.openape.ai/grant-approval/1' } }
  const desktopOnly = { sourceId: 'proposal:setup-1', type: 'proposal', digest: digest('setup-1'), podId: mac.podId, podName: 'Belege', title: 'Einrichtung prüfen', body: 'Die Einrichtung braucht einen lokalen Ordner.', authority: 'pods', options: [], link: null }
  const mailChoice = { sourceId: 'network-choice:mail-3', type: 'network-choice', digest: digest('choice-3'), podId: null, podName: null, title: 'Ready to explore this?', body: 'Review uncertain mail · Synthetic company · Mail network\naccount: owner@pods-inbox.test\ncategory: newsletter\nconfidence: 0.87\nsender: news@example.com\nurgency: normal', authority: 'pods', options: [{ key: 'keep', title: 'Keep for review', input: null }, { key: 'newsletter', title: 'Newsletter candidate', input: null }, { key: 'invoice', title: 'Invoice review', input: null }, { key: 'reply', title: 'Reply preview', input: null }], link: null }
  await mac.decisions([mailChoice, effect, idpGrant, desktopOnly])
  await mac.message('notify-1', 'Monatsabschluss bereit', 'Alle Belege für September sind abgelegt.', [{ title: 'Bericht öffnen', url: 'https://report.openape.ai/d/example' }])
  await mac.message('notify-2', 'Neue Rechnung', 'Eine Rechnung von Beispiel GmbH wurde erkannt.')

  // Sign-in inside the app lands on Decisions; both tabs carry separate counts.
  const { context, page } = await phone(owner)
  await expect.poll(() => page.getByRole('link', { name: /Entscheidungen/ }).textContent()).toContain('4')
  await expect.poll(() => page.getAttribute('html', 'data-app-badge')).toBe('6')
  const badge = await context.request.get(`${relay.url}/inbox/api/v1/badge`)
  expect(badge.headers()['cache-control']).toBe('private, no-store')
  expect(await badge.json()).toEqual({ count: 6 })
  expect((await fetch(`${relay.url}/inbox/api/v1/badge`)).status).toBe(401)
  // A mail choice shows its sender first and classification hints instead of the raw field list.
  const mailCard = page.locator('li.inbox-card', { hasText: 'Ready to explore this?' })
  expect(await mailCard.locator('.sender').textContent()).toContain('news@example.com')
  expect(await mailCard.textContent()).not.toContain('Review uncertain mail')
  expect(await page.getByRole('link', { name: /Mitteilungen/ }).textContent()).toContain('2')
  await expect.poll(() => page.evaluate(async () => !!(await navigator.serviceWorker.getRegistration('/inbox/'))?.active)).toBe(true)
  expect(await noHorizontalScroll(page)).toBe(true)
  await shot(page, '01-decisions')
  await page.emulateMedia({ colorScheme: 'dark' })
  await shot(page, '01b-decisions-dark')
  await page.emulateMedia({ colorScheme: 'light' })

  // An actual completed decision: evidence is required, acceptance is not shown as applied, the desktop applies it.
  await page.getByRole('link', { name: /Rechnung an Buchhaltung/ }).click()
  await page.getByRole('button', { name: 'Bereits zugestellt' }).click()
  await page.getByRole('button', { name: '„Bereits zugestellt“ senden' }).click()
  await expect.poll(() => page.getByText('Bitte zuerst ausfüllen.').isVisible()).toBe(true)
  await page.getByLabel('Was hast du festgestellt?').fill('Buchhaltung hat den Eingang telefonisch bestätigt.')
  expect(await page.getByText('Bitte zuerst ausfüllen.').isVisible()).toBe(false)
  await shot(page, '02-decision-evidence')
  await page.getByRole('button', { name: '„Bereits zugestellt“ senden' }).click()
  await expect.poll(() => page.getByRole('status').filter({ hasText: 'Angenommen' }).textContent()).toContain('noch nicht angewendet')
  await shot(page, '03-decision-accepted')
  const operation = await mac.claim()
  expect(operation!.command.body).toMatchObject({ type: 'decide', sourceId: 'effect:mail-1', digest: effect.digest, option: 'seen', input: 'Buchhaltung hat den Eingang telefonisch bestätigt.' })
  await mac.complete(operation!.id)
  await mac.decisions([idpGrant, desktopOnly])
  await expect.poll(() => page.getByText('Angewendet: Bereits zugestellt.').isVisible(), { timeout: 30000 }).toBe(true)
  await page.getByRole('button', { name: 'Aktualisieren' }).click()
  await expect.poll(() => page.getByText('Erledigt. Diese Entscheidung wartet nicht mehr.').isVisible()).toBe(true)
  await shot(page, '04-decision-applied')
  await page.getByRole('link', { name: /Zurück/ }).click()
  await expect.poll(() => page.locator('h2:has-text("Erledigt") + ul').textContent()).toContain('Rechnung an Buchhaltung')

  // IdP approvals leave for the IdP; desktop-only steps say so and offer nothing.
  await page.getByRole('link', { name: /Zugriff auf mail.example/ }).click()
  expect(await page.getByRole('link', { name: 'In OpenApe ID öffnen' }).getAttribute('href')).toBe('https://id.openape.ai/grant-approval/1')
  expect(await page.locator('section.decision button').count()).toBe(0)
  await shot(page, '05-decision-idp')
  await page.goto(`${relay.url}/inbox/`)
  await page.getByRole('link', { name: /Einrichtung prüfen/ }).click()
  await expect.poll(() => page.getByText('Dieser Schritt geht nur am Mac in OpenApe Pods.').isVisible()).toBe(true)

  // A full notification: opening it marks it read for the account; links stay external HTTPS.
  await page.getByRole('link', { name: /Mitteilungen/ }).click()
  await page.getByRole('heading', { name: 'Mitteilungen' }).waitFor()
  await shot(page, '06-messages')
  await page.getByRole('link', { name: /Monatsabschluss bereit/ }).click()
  expect(await page.getByRole('link', { name: 'Bericht öffnen' }).getAttribute('rel')).toBe('noopener noreferrer')
  await expect.poll(() => page.getByRole('link', { name: /Mitteilungen/ }).textContent()).toMatch(/Mitteilungen\s*1/)
  await expect.poll(() => page.getAttribute('html', 'data-app-badge')).toBe('3')
  expect(await (await context.request.get(`${relay.url}/inbox/api/v1/badge`)).json()).toEqual({ count: 3 })
  await shot(page, '07-message-detail')

  // Restart: the installed app reopens with the same session and read state.
  const state = await context.storageState()
  await context.close()
  const restarted = await phone(owner, state)
  await restarted.page.goto(`${relay.url}/inbox/messages`)
  await expect.poll(() => restarted.page.getByRole('link', { name: /Mitteilungen/ }).textContent()).toMatch(/Mitteilungen\s*1/)

  // Offline: the stored copy stays readable, with its time and account, and no active decision control.
  await mac.decisions([idpGrant, desktopOnly, { ...effect, sourceId: 'effect:mail-2', digest: digest('effect-2'), title: 'Zweite Zustellung prüfen' }])
  await restarted.page.getByRole('button', { name: 'Aktualisieren' }).click()
  await restarted.page.goto(`${relay.url}/inbox/`)
  await expect.poll(() => restarted.page.getByRole('link', { name: /Zweite Zustellung/ }).isVisible()).toBe(true)
  await restarted.context.setOffline(true)
  await restarted.page.reload()
  await expect.poll(() => restarted.page.getByText(/^Offline\. Gespeicherter Stand vom/).isVisible()).toBe(true)
  expect(await restarted.page.getByText(`Konto ${owner}`).isVisible()).toBe(true)
  await shot(restarted.page, '08-offline-list')
  await restarted.page.getByRole('link', { name: /Zweite Zustellung/ }).click()
  await expect.poll(() => restarted.page.getByText('Entscheiden ist nur online möglich.').isVisible()).toBe(true)
  expect(await restarted.page.locator('section.decision button:not([disabled])').count()).toBe(0)
  await shot(restarted.page, '09-offline-decision')
  await restarted.context.setOffline(false)

  // Back online, a Pods decision is answered straight from its card, after an undo window; the desktop receives exactly that option.
  await restarted.page.goto(`${relay.url}/inbox/`)
  const card = restarted.page.locator('li.inbox-card', { hasText: 'Zweite Zustellung' })
  const tops = () => restarted.page.locator('main > ul').first().locator('li.inbox-card').evaluateAll(cards => cards.map(node => Math.round(node.getBoundingClientRect().top)))
  await card.getByRole('button', { name: 'Erneut zustellen' }).waitFor()
  const before = await tops()
  await card.getByRole('button', { name: 'Erneut zustellen' }).click()
  await expect.poll(() => card.getByRole('status').textContent()).toContain('wird gleich gesendet')
  await card.getByRole('button', { name: 'Rückgängig' }).click()
  await expect.poll(() => card.getByRole('button', { name: 'Erneut zustellen' }).isVisible()).toBe(true)
  await restarted.page.waitForTimeout(5500)
  expect(await mac.claim()).toBeNull()
  await card.getByRole('button', { name: 'Erneut zustellen' }).click()
  await shot(restarted.page, '10-card-undo')
  await expect.poll(() => card.getByRole('status').textContent(), { timeout: 15000 }).toContain('noch nicht angewendet')
  // Neither the answer nor a decision arriving meanwhile moves any card: the new one waits behind a floating hint.
  await mac.decisions([idpGrant, desktopOnly, { ...effect, sourceId: 'effect:mail-2', digest: digest('effect-2'), title: 'Zweite Zustellung prüfen' }, { ...mailChoice, sourceId: 'network-choice:mail-4', digest: digest('choice-4'), title: 'Neue Mail während der Arbeit' }])
  await restarted.page.getByRole('button', { name: 'Aktualisieren' }).click()
  await expect.poll(() => restarted.page.getByRole('button', { name: '1 neue anzeigen' }).isVisible()).toBe(true)
  expect(await tops()).toEqual(before)
  await shot(restarted.page, '11-card-stable')
  expect((await mac.claim())!.command.body).toMatchObject({ type: 'decide', sourceId: 'effect:mail-2', option: 'deliver' })
  await restarted.page.getByRole('button', { name: '1 neue anzeigen' }).click()
  await expect.poll(() => restarted.page.locator('li.inbox-card', { hasText: 'Neue Mail während der Arbeit' }).isVisible()).toBe(true)

  // Reinstall: an empty browser signs in again and gets the account's read state from the service.
  const reinstalled = await phone(owner)
  await reinstalled.page.goto(`${relay.url}/inbox/messages`)
  await expect.poll(() => reinstalled.page.locator('.inbox-card.unread').count()).toBe(1)

  // Large text and small screen: content reflows without horizontal scrolling.
  await reinstalled.page.addStyleTag({ content: 'html, body { font-size: 28px !important; }' })
  await reinstalled.page.goto(`${relay.url}/inbox/settings`)
  await reinstalled.page.addStyleTag({ content: 'html, body { font-size: 28px !important; }' })
  await expect.poll(() => reinstalled.page.getByRole('heading', { name: 'Einstellungen' }).isVisible()).toBe(true)
  expect(await noHorizontalScroll(reinstalled.page)).toBe(true)
  // Values keep a readable line width instead of collapsing into a narrow column.
  expect(Math.min(...await reinstalled.page.locator('dd').evaluateAll(nodes => nodes.map(node => node.getBoundingClientRect().width)))).toBeGreaterThan(300)
  await shot(reinstalled.page, '12-settings-large-text')

  // Revocation from the other device: the restarted phone loses its session and its stored copy on the next sync.
  const devices = await reinstalled.page.evaluate(async () => (await (await fetch('/inbox/api/v1/devices')).json()) as { current: string, devices: { id: string }[] })
  const foreign = devices.devices.filter(device => device.id !== devices.current)
  for (const device of foreign) expect((await reinstalled.page.evaluate(async id => (await fetch(`/inbox/api/v1/devices/${id}/revoke`, { method: 'POST' })).status, device.id))).toBe(200)
  await restarted.page.goto(`${relay.url}/inbox/`)
  await expect.poll(() => restarted.page.getByText('Dieses Gerät wurde abgemeldet. Gespeicherte Einträge wurden entfernt.').isVisible()).toBe(true)
  expect(await restarted.page.evaluate(() => localStorage.getItem('pods-inbox-cache-v1'))).toBeNull()
  await expect.poll(() => restarted.page.getAttribute('html', 'data-app-badge')).toBe('0')
  expect(await restarted.page.locator('.inbox-card, section.decision').count()).toBe(0)
  await shot(restarted.page, '13-revoked')

  // Account switch in the same browser: sign-out wipes the copy, the other account never sees the first one's items.
  await reinstalled.page.getByRole('button', { name: 'Abmelden', exact: true }).last().click()
  await expect.poll(() => reinstalled.page.getByRole('button', { name: 'Weiter mit OpenApe' }).isVisible()).toBe(true)
  expect(await reinstalled.page.evaluate(() => localStorage.getItem('pods-inbox-cache-v1'))).toBeNull()
  // Test IdP only: drop its session so the next sign-in is the other person (cookies are shared across local ports).
  await reinstalled.context.clearCookies()
  await signIn(reinstalled.page, other)
  await expect.poll(() => reinstalled.page.getByText(other).first().isVisible()).toBe(true)
  await reinstalled.page.goto(`${relay.url}/inbox/`)
  await expect.poll(() => reinstalled.page.getByText('Keine offenen Entscheidungen.').isVisible()).toBe(true)
  expect(await reinstalled.page.evaluate(() => localStorage.getItem('pods-inbox-cache-v1') ?? '')).not.toContain('Rechnung')

  // A new service worker waits until the owner loads it; the old cache version is removed afterwards.
  // Playwright cannot route worker script updates, so the built file changes in place (same length for Nitro's asset size).
  // Nitro answers a revalidation from its build-time metadata with 304; a real deployment changes that metadata,
  // here the browser's HTTP cache is cleared instead so the update check downloads the changed bytes.
  const worker = join(process.cwd(), '.output/public/inbox/sw.js')
  const original = readFileSync(worker, 'utf8')
  const current = /const version = '([^']+)'/.exec(original)![1]!
  const next = current.replace(/.$/, last => last === 'x' ? 'y' : 'x')
  writeFileSync(worker, original.replace(`const version = '${current}'`, `const version = '${next}'`))
  try {
    await (await reinstalled.context.newCDPSession(reinstalled.page)).send('Network.clearBrowserCache')
    await reinstalled.page.evaluate(async () => (await navigator.serviceWorker.getRegistration('/inbox/'))!.update())
    await expect.poll(() => reinstalled.page.getByText('Eine neue Version ist bereit.').isVisible(), { timeout: 15000 }).toBe(true)
    // Installed but waiting: the page still runs under the old worker, both versions' shells exist side by side.
    expect(await reinstalled.page.evaluate(async () => ({ waiting: !!(await navigator.serviceWorker.getRegistration('/inbox/'))!.waiting, caches: (await caches.keys()).filter(name => name.startsWith('pods-inbox-')).sort() }))).toEqual({ waiting: true, caches: [`pods-inbox-${current}`, `pods-inbox-${next}`].sort() })
    await shot(reinstalled.page, '14-update-ready')
    await Promise.all([reinstalled.page.waitForEvent('load'), reinstalled.page.getByRole('button', { name: 'Jetzt laden' }).click()])
    await expect.poll(() => reinstalled.page.evaluate(async () => (await caches.keys()).filter(name => name.startsWith('pods-inbox-')))).toEqual([`pods-inbox-${next}`])
  }
  finally { writeFileSync(worker, original) }

  // English follows the setting.
  await reinstalled.page.goto(`${relay.url}/inbox/settings`)
  await reinstalled.page.getByLabel('Sprache').selectOption('en')
  await expect.poll(() => reinstalled.page.getByRole('heading', { name: 'Settings' }).isVisible()).toBe(true)
  await shot(reinstalled.page, '15-settings-english')
  await Promise.all([restarted.context.close(), reinstalled.context.close()])
}, 300000)
