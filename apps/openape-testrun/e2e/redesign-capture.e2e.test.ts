// Temporary acceptance capture for the Reports redesign (issue 1433). Removed in the final commit.
import type { RunningServer } from 'openape-e2e/lifecycle'
import type { Browser, Page } from 'playwright'
import { generateKeyPairSync } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { keyObjectToSshString } from 'openape-e2e/constants'
import { startIdp } from 'openape-e2e/idp-fixture'
import { loginWithSshKey } from 'openape-e2e/key-auth'
import { makeTempDir, startServer } from 'openape-e2e/lifecycle'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const artifacts = resolve(root, '.artifacts/redesign')
const examples = resolve(root, '../../packages/ape-testruns/examples')
const owner = 'mara@reports.test'; const empty = 'new.reader@reports.test'
const managementToken = 'redesign-disposable-management-token'
const png = Buffer.from(/data:image\/png;base64,([^"\s]+)/u.exec(readFileSync(join(examples, 'analysis.html'), 'utf8'))![1]!, 'base64')
let idp: RunningServer; let app: RunningServer; let browser: Browser; let prototype: ReturnType<typeof createServer> | undefined
let base = ''; const raw: Record<string, string> = {}; const token: Record<string, string> = {}
const ids: Record<string, string> = {}
const evidence: { name: string, file: string, viewport: string, scheme: string }[] = []

async function call(method: string, path: string, body?: unknown, as = owner, extra: Record<string, string> = {}) {
  const response = await fetch(`${base}${path}`, { method, redirect: 'manual', headers: { authorization: `Bearer ${token[as]}`, 'content-type': 'application/json', ...extra }, body: body === undefined ? undefined : JSON.stringify(body) })
  return response
}
async function identity(email: string) {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519'); const sshKey = keyObjectToSshString(publicKey, email)
  for (const [path, body] of [['/api/admin/users', { email, name: email, password: 'fixture-password-for-reports' }], [`/api/admin/users/${email}/ssh-keys`, { publicKey: sshKey, name: 'Fixture key' }]] as const) {
    const response = await fetch(`${idp.url}${path}`, { method: 'POST', headers: { authorization: `Bearer ${managementToken}`, 'content-type': 'application/json' }, body: JSON.stringify(body) })
    expect(response.status, await response.text()).toBeLessThan(300)
  }
  raw[email] = await loginWithSshKey(idp.url, email, privateKey, sshKey)
  const response = await call('POST', '/api/cli/exchange', { subject_token: raw[email] }, '')
  token[email] = (await response.json()).access_token
}
async function publish(key: string, html: string, metadata: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  const response = await call('POST', '/api/documents', { schemaVersion: 2, html, metadata, ...extra }, owner, { 'idempotency-key': key })
  expect(response.status, await response.clone().text()).toBeLessThan(300)
  return (await response.json()) as { document_id: string, version: number }
}
const page = (title: string, body: string, style: string) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><style>${style}</style></head><body>${body}</body></html>`
const dashboard = (title: string, week: number, images = '') => page(title, `<h1>${title}</h1><p class="lead">Median and tail latency of the checkout API, week ${week}.</p><div class="tabs"><button id="b1" class="on">p95</button><button id="b2">p99</button></div><svg viewBox="0 0 330 210">${[212, 198, 240, 231, 260, 244, 219].map((x, k) => `<rect x="${k * 46 + 8}" y="${180 - x * 0.6}" width="30" height="${x * 0.6}" rx="3" fill="#5EEAD4"/><text x="${k * 46 + 23}" y="198" fill="#94A3B8" font-size="11" text-anchor="middle">${['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'][k]}</text>`).join('')}</svg><p id="note">p95 stayed under 260 ms all week.</p>${images}<script>b2.onclick=()=>{note.textContent='p99 peaked at 610 ms on Friday during the batch import.';b2.className='on';b1.className=''};b1.onclick=()=>{note.textContent='p95 stayed under 260 ms all week.';b1.className='on';b2.className=''}</script>`, 'body{margin:0;background:#0F1B2D;color:#E2E8F0;font:15px/1.6 "Avenir Next",system-ui;padding:40px 48px}h1{font-size:40px;margin:0 0 6px;letter-spacing:-.02em}.lead{color:#94A3B8;margin:0 0 28px}.tabs{display:flex;gap:12px;margin-bottom:18px}button{background:transparent;color:#E2E8F0;border:1px solid #334155;border-radius:6px;padding:6px 14px}button.on{background:#5EEAD4;color:#0F1B2D;border-color:#5EEAD4;font-weight:600}svg{width:100%;max-width:640px;background:#13233A;border-radius:12px;padding:14px;box-sizing:border-box}img{max-width:300px;display:block;margin-top:18px;border-radius:8px}')
const analysis = (title: string) => page(title, `<h1>${title}</h1><p>This synthetic analysis stands in for a published report. Its layout, fonts and colors belong to the document, not to Reports.</p><h2>Findings</h2><ul><li>Three items need an owner decision.</li><li>Two shared links expired last month.</li><li>One restored report is still private.</li></ul>`, 'body{margin:0;background:#F7F4EE;color:#222;font:17px/1.7 Georgia,serif;padding:48px clamp(20px,8vw,110px)}h1{font:700 34px/1.2 system-ui;letter-spacing:-.02em;margin:0 0 18px}h2{font:700 20px system-ui;margin-top:32px}')
const testrun = (title: string) => page(title, `<h1>${title}</h1><p class="fail">2 failed, 41 passed</p><label><input type="checkbox" id="f"> Show failures only</label><table id="t">${[['Checkout with saved card', 1], ['Apply voucher', 0], ['Invoice download', 0], ['Order history paging', 1]].map(([n, ok]) => `<tr data-ok="${ok}"><td>${n}</td><td class="${ok ? 'ok' : 'bad'}">${ok ? 'Passed' : 'Failed'}</td></tr>`).join('')}</table><script>f.onchange=()=>t.querySelectorAll('tr').forEach(r=>r.style.display=f.checked&&r.dataset.ok==='1'?'none':'')</script>`, 'body{margin:0;background:#FAFAF9;color:#1C1917;font:15px/1.55 system-ui;padding:36px 40px}h1{font-size:30px;margin:0}.fail{margin:6px 0 22px;font-size:18px;color:#B91C1C;font-weight:700}table{width:100%;max-width:720px;border-collapse:collapse}td{padding:9px 0;border-bottom:1px solid #E7E5E4}.ok{color:#15803D;text-align:right}.bad{color:#B91C1C;text-align:right}')

beforeAll(async () => {
  mkdirSync(artifacts, { recursive: true })
  idp = await startIdp({ managementToken, ddisaMockRecords: { 'reports.test': { version: 'ddisa1', idp: 'https://idp.reports.test', mode: 'open' } } })
  app = await startServer({ cwd: root, readyPath: '/api/health', timeoutMs: 180000, env: ({ url }) => ({
    NUXT_HTML_PUBLISHING_ENABLED: 'true', NUXT_PLANS_CONSOLIDATED: 'true', NUXT_PLANS_INVITE_SECRET: 'synthetic-plans-invite-secret-at-least-32', NUXT_IGNORE_LOCK: '1', NUXT_TURSO_URL: `file:${join(makeTempDir('redesign-e2e-'), 'reports.db')}`, NUXT_OPENAPE_SP_SESSION_SECRET: 'redesign-e2e-secret-at-least-32-characters-long', NUXT_OPENAPE_SP_CLIENT_ID: new URL(url).host, NUXT_FALLBACK_IDP_URL: idp.url, NUXT_PUBLIC_URL: url, NUXT_BRIEFING_URL: url,
    NUXT_HTML_CONTENT_ORIGIN: url.replace('127.0.0.1', 'localhost'), NUXT_PUBLIC_HTML_CONTENT_ORIGIN: url.replace('127.0.0.1', 'localhost'),
    DDISA_MOCK_RECORDS: JSON.stringify({ 'reports.test': { version: 'ddisa1', idp: idp.url, mode: 'open' } }), OPENAPE_SP_ALLOW_INSECURE_IDP: '1',
  }) })
  base = app.url
  await identity(owner); await identity(empty)
  browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true })
  if (process.env.PROTOTYPE_PATH) {
    const html = readFileSync(process.env.PROTOTYPE_PATH)
    prototype = createServer((_, response) => { response.writeHead(200, { 'content-type': 'text/html' }); response.end(html) })
    await new Promise<void>(done => prototype!.listen(0, '127.0.0.1', done))
  }
}, 300000)
afterAll(async () => { prototype?.close(); await browser?.close(); await app?.stop(); await idp?.stop() })

it('seeds a synthetic library and proves the CLI-only plan writes', async () => {
  const team = await (await call('POST', '/api/plans-compat/teams', { name: 'Platform team' })).json()
  const images = '<img src="https://images.example.test/chart-1.png" alt="Error rate chart"><img src="https://images.example.test/chart-2.png" alt="Throughput chart">'
  const plan = await (await call('POST', `/api/plans-compat/teams/${team.id}/plans`, { title: 'Relay rollout plan for the October release', body_md: '# Relay rollout plan\n\n## Goal\nMove all workspaces to the new relay without interrupting scheduled work.\n\n## Steps\n1. Deploy the relay to the canary region.\n2. Watch error rates for 48 hours.\n3. Move the remaining regions in two waves.\n', status: 'active' })).json()
  ids.plan = plan.id
  expect((await call('PATCH', `/api/plans-compat/plans/${plan.id}`, { title: plan.title, body_md: '# Changed', status: 'active' })).status).toBe(428)
  expect((await call('PATCH', `/api/plans-compat/plans/${plan.id}`, { title: plan.title, body_md: '# Changed', status: 'active', expected_version: 7 })).status).toBe(409)
  expect((await call('PATCH', `/api/plans-compat/plans/${plan.id}`, { title: plan.title, body_md: '# Relay rollout plan\n\n## Rollback\nKeep the previous relay image for 14 days.\n', status: 'active', expected_version: plan.version })).status).toBe(200)
  await call('POST', `/api/plans-compat/teams/${team.id}/plans`, { title: 'Onboarding flow redesign', body_md: '# Onboarding flow redesign\n\nThree screens instead of seven.\n', status: 'draft' })

  const latency = await publish('latency-1', dashboard('Checkout latency, week 40', 40, images), { category: 'Reports', tags: ['performance', 'checkout', 'weekly'], metadata: { 'report.period': '2026-W40', 'report.source': 'synthetic-metrics' } }, { audience: { mode: 'team', teamId: team.id } })
  ids.latency = latency.document_id
  await publish('latency-2', dashboard('Checkout latency, week 40', 40, images), { category: 'Reports', tags: ['performance', 'checkout', 'weekly'], metadata: { 'report.period': '2026-W40', 'report.source': 'synthetic-metrics' } }, { documentId: latency.document_id, expectedVersion: 1 })
  await publish('latency-3', dashboard('Checkout latency, week 40', 40, images), { category: 'Reports', tags: ['performance', 'checkout', 'weekly'], metadata: { 'report.period': '2026-W40', 'report.source': 'synthetic-metrics' } }, { documentId: latency.document_id, expectedVersion: 2 })
  ids.nightly = (await publish('nightly', testrun('Nightly end-to-end run 1842'), { category: 'Test Runs', tags: ['nightly', 'e2e', 'checkout'], metadata: { 'tests.result': 'failed', 'tests.commit': '4f9c2e1' } }, { lifetime: { expiresIn: '6d' } })).document_id
  await publish('access', analysis('Quarterly access review for shared team reports, including named readers, expired links and restored documents that still need an owner decision'), { category: 'Reports', tags: ['access', 'review', 'quarterly'] })
  await publish('incident', analysis('Incident summary: delayed notifications on September 29'), { category: 'Reports', tags: ['incident', 'notifications'] }, { audience: { mode: 'public' } })
  await publish('interviews', analysis('Customer interview notes: invoicing workflow'), { category: 'Reports', tags: ['research', 'invoicing'] }, { audience: { mode: 'readers', readers: ['jonas@reports.test'] } })
  await publish('deps', analysis('Dependency update summary'), { category: 'Reports', tags: ['maintenance', 'security'] }, { audience: { mode: 'team', teamId: team.id } })
  for (const [key, title] of [['staging', 'Old staging dashboard snapshot'], ['pricing', 'Draft pricing analysis (duplicate)']]) {
    const removed = await publish(key!, analysis(title!), { category: 'Reports', tags: ['archive'] })
    expect((await call('DELETE', `/api/documents/${removed.document_id}`, { expectedVersion: 1 })).status).toBe(200)
    ids[key!] = removed.document_id
  }
  const run = await (await call('POST', '/api/runs', { title: 'Mobile layout check, iPhone and Android', project: 'reports', summary: 'Layout check of the **reports** app on two phones.', tests: [{ id: 'layout', title: 'Library fits a phone', status: 'passed', steps: [{ title: 'iPhone, light', status: 'passed', shot: 'iphone.png' }, { title: 'Pixel, dark', status: 'passed', shot: 'pixel.png' }] }, { id: 'reader', title: 'Reader keeps the bar visible', status: 'passed', steps: [{ title: 'Opened report', status: 'passed' }] }] })).json()
  for (const shot of ['iphone.png', 'pixel.png']) expect((await fetch(`${base}/api/runs/${run.id}/assets/${shot}`, { method: 'PUT', headers: { authorization: `Bearer ${token[owner]}`, 'content-type': 'image/png' }, body: png })).status).toBe(201)
  ids.run = run.slug

  const edit = await fetch(`${base}/d/${ids.latency}/edit?v=2`, { redirect: 'manual' })
  expect(edit.status).toBe(301)
  expect(edit.headers.get('location')).toBe(`/d/${ids.latency}?v=2`)
  expect((await fetch(`${base}/reports/removed`, { redirect: 'manual' })).headers.get('cache-control')).toBe('private, no-store')
}, 120000)

async function signedIn(email: string, viewport: { width: number, height: number }, scheme: 'light' | 'dark') {
  const context = await browser.newContext({ viewport, colorScheme: scheme, deviceScaleFactor: 2 })
  await context.route('https://images.example.test/**', route => route.fulfill({ contentType: 'image/png', body: png }))
  const login = await context.request.post(`${base}/api/login`, { data: { email } })
  const authorization = await context.request.get((await login.json()).redirectUrl, { headers: { authorization: `Bearer ${raw[email]}` }, maxRedirects: 0 })
  const page = await context.newPage()
  await page.goto(authorization.headers().location!); await page.waitForURL('**/reports')
  return { context, page }
}
// Interactions need the hydrated app; the server-rendered page alone has no handlers.
async function go(page: Page, url: string) {
  await page.goto(url)
  await page.waitForFunction(() => Boolean((document.querySelector('#__nuxt') as { __vue_app__?: unknown } | null)?.__vue_app__))
  await page.waitForLoadState('networkidle')
}
async function shot(page: Page, name: string, viewport: string, scheme: string) {
  await page.waitForTimeout(250)
  const file = `${name}-${viewport}-${scheme}.png`
  await page.screenshot({ path: join(artifacts, file) })
  evidence.push({ name, file, viewport, scheme })
}

for (const [label, viewport] of [['desktop', { width: 1440, height: 900 }], ['mobile', { width: 375, height: 812 }]] as const) {
  for (const scheme of ['light', 'dark'] as const) {
    it(`captures every state at ${label} ${scheme}`, async () => {
      const { context, page } = await signedIn(owner, viewport, scheme)
      try {
        await go(page, `${base}/reports`); await page.locator('a.row').first().waitFor()
        expect(await page.locator('a.row').count()).toBe(9)
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
        await shot(page, 'library', label, scheme)
        await page.getByRole('button', { name: /^Filters/u }).click(); await page.getByRole('dialog', { name: 'Filters' }).waitFor()
        await shot(page, 'filters', label, scheme)
        await page.getByRole('radio', { name: 'A team' }).check(); await page.getByRole('button', { name: 'Show results' }).click()
        await expect.poll(() => page.locator('a.row').count()).toBe(4)
        await go(page, `${base}/reports?tag=checkout`); await expect.poll(() => page.locator('a.row').count()).toBe(2)
        await shot(page, 'library-filtered', label, scheme)
        await go(page, `${base}/reports`); await page.keyboard.press('/'); await page.keyboard.type('zzzz'); await page.getByText('No reports match “zzzz”').waitFor()
        await shot(page, 'no-match', label, scheme)
        await go(page, `${base}/reports`); await page.locator('.top-actions .btn').click(); await page.getByRole('dialog', { name: 'Publish a report' }).waitFor()
        await shot(page, 'publish', label, scheme)

        await go(page, `${base}/d/${ids.latency}`); await page.getByRole('button', { name: 'Open report' }).waitFor()
        expect(await page.locator('iframe').count()).toBe(0)
        await shot(page, 'gate', label, scheme)
        await page.getByRole('button', { name: 'Open report' }).click()
        const frame = page.frameLocator('iframe'); await frame.locator('#note').waitFor()
        await frame.locator('#b2').click()
        expect(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight)).toBe(true)
        expect(await page.locator('iframe').getAttribute('sandbox')).toBe('allow-scripts')
        await shot(page, 'opened', label, scheme)
        await page.getByRole('button', { name: 'Details, versions and download' }).click(); await page.getByRole('dialog', { name: 'Details' }).getByText('Version 1', { exact: true }).waitFor()
        await shot(page, 'details', label, scheme)
        await page.keyboard.press('Escape')
        await go(page, `${base}/d/${ids.latency}?v=1`); await page.getByText('Version 1 of 3').waitFor()
        await shot(page, 'old-version', label, scheme)
        await go(page, `${base}/d/${ids.nightly}`); await page.getByText('6 days left').waitFor()
        await shot(page, 'expiring', label, scheme)
        await go(page, `${base}/d/${ids.plan}`); await page.getByRole('button', { name: 'Open report' }).click(); await page.frameLocator('iframe').getByText('Rollback').first().waitFor()
        await shot(page, 'plan', label, scheme)
        await go(page, `${base}/r/${ids.run}`); await page.locator('.shot img').first().waitFor()
        await shot(page, 'legacy', label, scheme)
        await go(page, `${base}/d/01NOTAREALDOCUMENT0000000000`); await page.getByText('This report isn\'t available').waitFor()
        await shot(page, 'unavailable', label, scheme)

        await go(page, `${base}/reports/removed`); await page.getByText('Draft pricing analysis (duplicate)').waitFor()
        await shot(page, 'removed', label, scheme)
        await page.getByRole('button', { name: 'Restore' }).first().click(); await page.getByRole('dialog', { name: 'Restore report' }).waitFor()
        await shot(page, 'restore', label, scheme)
        await page.keyboard.press('Escape')
      }
      finally { await context.close() }
      // The document API allows 60 requests per minute and address; every fixture browser shares 127.0.0.1.
      await new Promise(done => setTimeout(done, 61000))
      const other = await signedIn(empty, viewport, scheme)
      try {
        await go(other.page, `${base}/reports`); await other.page.getByText('No reports yet').waitFor()
        await shot(other.page, 'empty', label, scheme)
        await go(other.page, `${base}/reports/removed`); await other.page.getByText('Nothing to restore').waitFor()
        await shot(other.page, 'removed-empty', label, scheme)
      }
      finally { await other.context.close() }
      if (prototype) {
        const context = await browser.newContext({ viewport: label === 'mobile' ? { width: 375, height: 840 } : { width: 1440, height: 928 }, colorScheme: scheme, deviceScaleFactor: 2 })
        const proto = await context.newPage()
        const { port } = prototype.address() as { port: number }
        for (const [name, hash] of [['library', '#/'], ['gate', '#/d/r-latency'], ['removed', '#/removed']] as const) {
          await proto.goto(`http://127.0.0.1:${port}/${hash}`); await proto.evaluate(() => document.querySelector('.proto-panel')?.remove())
          await proto.waitForTimeout(200)
          await proto.screenshot({ path: join(artifacts, `prototype-${name}-${label}-${scheme}.png`), clip: { x: 0, y: 28, width: label === 'mobile' ? 375 : 1440, height: label === 'mobile' ? 812 : 900 } })
        }
        await context.close()
      }
    }, 300000)
  }
}

it('restores a removed report privately through the dialog', async () => {
  const { context, page } = await signedIn(owner, { width: 1440, height: 900 }, 'light')
  try {
    await go(page, `${base}/reports/removed`)
    await page.locator('.row', { hasText: 'Old staging dashboard snapshot' }).getByRole('button', { name: 'Restore' }).click()
    await page.getByRole('radio', { name: '7 days' }).check()
    await page.getByRole('button', { name: 'Restore privately' }).click()
    await page.getByText('Restored “Old staging dashboard snapshot”. Only you can open it.').waitFor()
    await shot(page, 'restored', 'desktop', 'light')
    const restored = await (await call('GET', `/api/documents/${ids.staging}`)).json()
    expect(restored.audience).toBe('private')
    expect(Math.abs(restored.expires_at - (Date.now() + 7 * 86400000))).toBeLessThan(120000)
  }
  finally { await context.close() }
  writeFileSync(join(artifacts, 'evidence.json'), JSON.stringify(evidence, null, 2))
}, 120000)
