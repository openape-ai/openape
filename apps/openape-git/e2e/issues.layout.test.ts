import type { Browser, Page } from 'playwright'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import process from 'node:process'
import { chromium } from 'playwright'
import { afterAll, afterEach, beforeAll, expect, it } from 'vitest'
import { owner, startIssueFixture } from './fixture'

let fixture: Awaited<ReturnType<typeof startIssueFixture>>
let user: Awaited<ReturnType<typeof fixture.identity>>
let browser: Browser
let page: Page
const artifactDir = resolve('.artifacts/issues')
beforeAll(async () => {
  fixture = await startIssueFixture()
  user = await fixture.identity(owner)
  expect((await user.call('POST', '/api/repos', { owner: 'owner', name: 'project' })).ok).toBe(true)
  browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true })
  const context = await browser.newContext()
  await context.addCookies(user.cookie.split('; ').map((cookie) => {
    const index = cookie.indexOf('=')
    return { name: cookie.slice(0, index), value: cookie.slice(index + 1), url: fixture.base, httpOnly: true, sameSite: 'Lax' as const }
  }))
  page = await context.newPage()
  page.on('pageerror', error => console.error('Browser error:', error.message))
  mkdirSync(artifactDir, { recursive: true })
})
afterEach(async ({ task }) => { if (task.result?.state === 'fail' && page) { await page.screenshot({ path: `${artifactDir}/failure.png`, fullPage: true }); console.error(await page.locator('body').textContent()) } })
afterAll(async () => { await browser?.close(); await fixture?.stop() })

async function visible(text: string) { await page.getByText(text, { exact: true }).first().waitFor() }
async function screenshot(name: string) {
  await page.screenshot({ path: `${artifactDir}/${name}.png`, fullPage: true })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
}

it('creates, previews, discusses, filters and triages at desktop and phone widths', async () => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.goto(`${fixture.base}/owner/project/issues/new`)
  await page.getByLabel('Title', { exact: true }).fill('Report a problem without losing context')
  await page.getByLabel('Description', { exact: true }).fill(`## Expected behavior\nKeep **product context** after login.\n\n\`\`\`text\n${'a'.repeat(160)}\n\`\`\``)
  const previewResponse = page.waitForResponse(response => response.url().endsWith('/api/issue-preview'))
  await page.getByRole('button', { name: 'Preview', exact: true }).click()
  const preview = await previewResponse
  expect(await preview.json()).toMatchObject({ bodyHtml: expect.stringContaining('Expected behavior') })
  await page.getByRole('heading', { name: 'Expected behavior' }).waitFor()
  await screenshot('new-desktop')
  await page.setViewportSize({ width: 390, height: 844 })
  await screenshot('new-mobile')
  await page.getByRole('button', { name: 'Create issue', exact: true }).focus()
  await page.keyboard.press('Enter')
  await page.waitForURL('**/owner/project/issues/1')
  await page.getByRole('heading', { name: /Report a problem/ }).waitFor()
  await page.getByLabel('Leave a comment', { exact: true }).fill('Confirmed on mobile. Ready for triage.')
  await page.getByRole('button', { name: 'Comment', exact: true }).focus()
  await page.keyboard.press('Enter')
  await visible('Confirmed on mobile. Ready for triage.')
  await page.reload()
  await visible('Confirmed on mobile. Ready for triage.')
  await page.locator('summary').filter({ hasText: 'Create label' }).click()
  await page.getByLabel('Label name').fill('bug')
  await page.getByRole('button', { name: 'Create label', exact: true }).click()
  await page.getByLabel('bug', { exact: true }).check()
  await page.getByLabel('Assign to').selectOption(owner)
  await page.getByRole('button', { name: 'Save metadata' }).click()
  await page.getByRole('button', { name: 'Save metadata' }).waitFor()
  await expect.poll(async () => (await (await user.call('GET', '/api/repos/owner/project/issues/1')).json()).labels.length).toBe(1)
  const discussion = await page.getByRole('region', { name: 'Discussion' }).boundingBox()
  const metadata = await page.getByRole('complementary', { name: 'Issue details' }).boundingBox()
  expect(metadata!.y).toBeGreaterThan(discussion!.y + discussion!.height)
  await screenshot('detail-mobile')
  await page.setViewportSize({ width: 1440, height: 1000 })
  await screenshot('detail-desktop')
  await page.getByRole('button', { name: 'Close issue', exact: true }).click()
  await page.getByRole('button', { name: 'Reopen issue', exact: true }).waitFor()
  await page.getByRole('button', { name: 'Reopen issue', exact: true }).click()
  await page.getByRole('button', { name: 'Close issue', exact: true }).waitFor()
  await page.goto(`${fixture.base}/owner/project/issues`)
  await visible('Report a problem without losing context')
  await screenshot('repository-desktop')
  await page.setViewportSize({ width: 390, height: 844 })
  await screenshot('repository-mobile')
  await page.goto(`${fixture.base}/issues`)
  await visible('Report a problem without losing context')
  await page.getByLabel('Search issues').fill('missing')
  await page.getByRole('button', { name: 'Search', exact: true }).click()
  await visible('No issues match these filters.')
  await page.reload()
  await visible('No issues match these filters.')
  expect(await page.getByLabel('Search issues').inputValue()).toBe('missing')
  await page.goBack()
  await visible('Report a problem without losing context')
  await screenshot('overview-mobile')
  await page.setViewportSize({ width: 1440, height: 1000 })
  await screenshot('overview-desktop')
  const views = ['new', 'detail', 'repository', 'overview']
  const shots = views.flatMap(view => ['desktop', 'mobile'].map(size => ({ title: `${view} — ${size}`, shot: `${view}-${size}.png`, status: 'passed' })))
  writeFileSync(`${artifactDir}/testrun.json`, JSON.stringify({ title: 'Native issues: repository and ecosystem UI', project: 'OpenApe', summary: 'Actual Nuxt UI and private SQLite fixture after real DDISA login. Keyboard creation/commenting, Markdown preview, labels, assignment, close/reopen, URL filters and 390/1440px layouts pass. Synthetic data only; production issues are unchanged.', tests: [{ id: 'native-issues-ui', title: 'Find, discuss and triage development issues', status: 'passed', steps: shots }] }, null, 2))
  writeFileSync(`${artifactDir}/report.html`, `<!doctype html><html lang="en"><meta charset="utf-8"><title>Native issues UI verification</title><style>body{background:#09090b;color:#e4e4e7;font:16px system-ui;max-width:1200px;margin:auto;padding:24px}img{max-width:100%}section{border:1px solid #3f3f46;padding:16px;margin:24px 0}b{color:#34d399}</style><h1>Native issues UI verification</h1><p><b>Passed</b> · Real DDISA login → create → preview → comment → triage → filter. Synthetic data.</p>${shots.map(shot => `<section><h2>${shot.title}</h2><img alt="${shot.title}" src="data:image/png;base64,${readFileSync(`${artifactDir}/${shot.shot}`).toString('base64')}"></section>`).join('')}</html>`)
})

it('keeps product selection across login and gives reporters only their own discussion', async () => {
  expect((await user.call('PATCH', '/api/repos/owner/project/issue-policy', { reportingEnabled: true, expectedVersion: 1 })).ok).toBe(true)
  expect((await user.call('PUT', '/api/repos/owner/project/issue-products/plans', { name: 'Plans', enabled: true, expectedVersion: 0 })).ok).toBe(true)
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
  const reporterPage = await context.newPage()
  try {
    await reporterPage.goto(`${fixture.base}/report?product=plans`)
    await reporterPage.waitForURL(`${fixture.base}/`)
    const reporter = await fixture.identity('reporter@issues.test')
    await context.addCookies(reporter.cookie.split('; ').map((cookie) => {
      const index = cookie.indexOf('=')
      return { name: cookie.slice(0, index), value: cookie.slice(index + 1), url: fixture.base, httpOnly: true, sameSite: 'Lax' as const }
    }))
    await reporterPage.reload()
    await reporterPage.waitForURL('**/report?product=plans')
    await reporterPage.getByLabel('What happened?').fill('Plans lost my selected product after login')
    await reporterPage.getByLabel('Expected and actual behavior', { exact: true }).fill('Expected: retain Plans. Actual: context is missing. Reproduced with a new session.')
    expect(await reporterPage.getByLabel('Product', { exact: true }).inputValue()).toBe('plans')
    const shots = []
    for (const [name, width, height] of [['desktop', 1440, 1000], ['mobile', 390, 844]] as const) {
      await reporterPage.setViewportSize({ width, height })
      await reporterPage.screenshot({ path: `${artifactDir}/report-${name}.png`, fullPage: true })
      expect(await reporterPage.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
      shots.push({ title: `Product reporting — ${name}`, shot: `report-${name}.png`, status: 'passed' })
    }
    await reporterPage.getByRole('button', { name: 'Submit report', exact: true }).focus()
    await reporterPage.keyboard.press('Enter')
    await reporterPage.waitForURL('**/i/*')
    await reporterPage.getByRole('heading', { name: 'Plans lost my selected product after login' }).waitFor()
    expect(await reporterPage.locator('body').textContent()).not.toContain('owner/project')
    expect(await reporterPage.getByRole('button', { name: 'Save metadata' }).count()).toBe(0)
    await reporterPage.getByLabel('Leave a comment', { exact: true }).fill('I can follow my own report.')
    await reporterPage.getByRole('button', { name: 'Comment', exact: true }).click()
    await reporterPage.getByText('I can follow my own report.', { exact: true }).waitFor()
    expect((await reporter.call('GET', '/api/repos/owner/project/issues')).status).toBe(404)
    const id = new URL(reporterPage.url()).pathname.split('/').at(-1)
    const issue = await (await user.call('GET', `/api/issue-records/${id}`)).json()
    expect((await user.call('POST', `/api/issue-records/${id}/moderation`, { revokeParticipant: 'reporter@issues.test', reason: 'Verify revocation', expectedVersion: issue.version })).ok).toBe(true)
    await reporterPage.reload()
    await reporterPage.getByRole('alert').waitFor()
    expect(await reporterPage.locator('body').textContent()).not.toContain('I can follow my own report.')
    const manifest = JSON.parse(readFileSync(`${artifactDir}/testrun.json`, 'utf8'))
    manifest.tests.push({ id: 'product-reporting-ui', title: 'Preselected product, private participant discussion and revocation', status: 'passed', steps: shots })
    writeFileSync(`${artifactDir}/testrun.json`, JSON.stringify(manifest, null, 2))
    const report = readFileSync(`${artifactDir}/report.html`, 'utf8')
    writeFileSync(`${artifactDir}/report.html`, report.replace('</html>', `${shots.map(shot => `<section><h2>${shot.title}</h2><img alt="${shot.title}" src="data:image/png;base64,${readFileSync(`${artifactDir}/${shot.shot}`).toString('base64')}"></section>`).join('')}</html>`))
  }
  finally { await context.close() }
})

it('shows reciprocal related links and a merged PR without implicitly closing its issue', async () => {
  const heads = await fixture.seedBranches('owner', 'project')
  const pull = await (await user.call('POST', '/api/repos/owner/project/pulls', { title: 'Preserve product context', source: 'fix-issue', target: 'main' })).json()
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.goto(`${fixture.base}/owner/project/issues/1`)
  await page.getByRole('region', { name: 'Linked pull requests' }).getByText('No visible links.', { exact: true }).waitFor()
  await page.locator('summary').filter({ hasText: 'Link pull request' }).click()
  await page.getByLabel('Pull request repository', { exact: true }).fill('owner/project')
  await page.getByLabel('Pull request number', { exact: true }).fill(String(pull.number))
  await page.getByRole('button', { name: 'Add related pull request', exact: true }).click()
  await page.getByRole('link', { name: 'Preserve product context', exact: true }).waitFor()
  const shots = []
  for (const [view, path, text] of [
    ['issue-linked', '/owner/project/issues/1', 'Preserve product context'],
    ['pull-linked', `/owner/project/pulls/${pull.number}`, 'Report a problem without losing context'],
  ]) {
    await page.goto(`${fixture.base}${path}`)
    await page.getByRole('link', { name: text, exact: true }).waitFor()
    for (const [size, width, height] of [['desktop', 1440, 1000], ['mobile', 390, 844]] as const) {
      await page.setViewportSize({ width, height })
      await screenshot(`${view}-${size}`)
      shots.push({ title: `${view} — ${size}`, shot: `${view}-${size}.png`, status: 'passed' })
    }
  }
  const merged = await user.call('POST', `/api/repos/owner/project/pulls/${pull.number}/merge`, { expectedSourceSha: heads.sourceSha, expectedTargetSha: heads.targetSha })
  expect(merged.status).toBe(200)
  await page.goto(`${fixture.base}/owner/project/issues/1`)
  await page.getByRole('region', { name: 'Linked pull requests' }).getByText(/Related.*merged/).waitFor()
  await page.getByRole('button', { name: 'Close issue', exact: true }).waitFor()
  await page.getByRole('button', { name: 'Unlink Preserve product context', exact: true }).click()
  await page.getByRole('region', { name: 'Linked pull requests' }).getByText('No visible links.', { exact: true }).waitFor()
  const manifest = JSON.parse(readFileSync(`${artifactDir}/testrun.json`, 'utf8'))
  manifest.tests.push({ id: 'issue-pr-links', title: 'Explicit relation, reciprocal view and manual issue resolution', status: 'passed', steps: shots })
  writeFileSync(`${artifactDir}/testrun.json`, JSON.stringify(manifest, null, 2))
  writeFileSync(`${artifactDir}/report.html`, readFileSync(`${artifactDir}/report.html`, 'utf8').replace('</html>', `${shots.map(shot => `<section><h2>${shot.title}</h2><img alt="${shot.title}" src="data:image/png;base64,${readFileSync(`${artifactDir}/${shot.shot}`).toString('base64')}"></section>`).join('')}</html>`))
})

it('creates an external-code issue home and hides native code, pull and mirror controls', async () => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.goto(fixture.base)
  await page.getByLabel('Repository owner', { exact: true }).fill('owner')
  await page.getByLabel('Repository name', { exact: true }).fill('external')
  await page.getByLabel('Issues only; keep code at its current host', { exact: true }).check()
  await page.getByLabel('External code URL', { exact: true }).fill('https://code.example/owner/external')
  await page.getByRole('button', { name: 'Create', exact: true }).click()
  await page.waitForURL('**/owner/external/issues')
  await page.getByRole('link', { name: 'View external code', exact: true }).waitFor()
  expect(await page.getByRole('link', { name: 'Code', exact: true }).count()).toBe(0)
  expect(await page.getByRole('link', { name: 'Pulls', exact: true }).count()).toBe(0)
  const shots = []
  for (const [size, width, height] of [['desktop', 1440, 1000], ['mobile', 390, 844]] as const) {
    await page.setViewportSize({ width, height })
    await screenshot(`external-home-${size}`)
    shots.push({ title: `External code issue home — ${size}`, shot: `external-home-${size}.png`, status: 'passed' })
  }
  await page.getByRole('link', { name: 'Access', exact: true }).click()
  await page.getByRole('heading', { name: 'Product issue reporting' }).waitFor()
  expect(await page.getByText('Push mirrors', { exact: true }).count()).toBe(0)
  expect(await page.getByText('Webhooks', { exact: true }).count()).toBe(0)
  await page.goto(`${fixture.base}/owner/external`)
  await page.waitForURL('**/owner/external/issues')
  const manifest = JSON.parse(readFileSync(`${artifactDir}/testrun.json`, 'utf8'))
  manifest.tests.push({ id: 'external-issue-home', title: 'External Git authority retained', status: 'passed', steps: shots })
  writeFileSync(`${artifactDir}/testrun.json`, JSON.stringify(manifest, null, 2))
  writeFileSync(`${artifactDir}/report.html`, readFileSync(`${artifactDir}/report.html`, 'utf8').replace('</html>', `${shots.map(shot => `<section><h2>${shot.title}</h2><img alt="${shot.title}" src="data:image/png;base64,${readFileSync(`${artifactDir}/${shot.shot}`).toString('base64')}"></section>`).join('')}</html>`))
})

it('opens a migrated comment after login and displays original attribution and protected downloads', async () => {
  const repository = await (await user.call('POST', '/api/repos', { owner: 'owner', name: 'archive' })).json()
  const imported = await fixture.seedImport({ id: repository.id, owner: 'owner', name: 'archive' })
  const context = await browser.newContext()
  const reader = await context.newPage()
  try {
    await reader.goto(`${fixture.base}/legacy?url=${encodeURIComponent(imported.sourceUrl)}#issuecomment-99`)
    await reader.waitForURL(`${fixture.base}/`)
    await context.addCookies(user.cookie.split('; ').map((cookie) => { const index = cookie.indexOf('='); return { name: cookie.slice(0, index), value: cookie.slice(index + 1), url: fixture.base, httpOnly: true, sameSite: 'Lax' as const } }))
    await reader.reload()
    await reader.waitForURL(`**/i/${imported.issueId}#comment-${imported.commentId}`)
    await reader.getByText('Original comment retained across migration.', { exact: true }).waitFor()
    await reader.getByText('Imported from Forgejo: Ghost', { exact: true }).waitFor()
    expect(await reader.getByLabel('Leave a comment', { exact: true }).count()).toBe(0)
    const shots = []
    for (const [size, width, height] of [['desktop', 1440, 1000], ['mobile', 390, 844]] as const) {
      await reader.setViewportSize({ width, height })
      await reader.screenshot({ path: `${artifactDir}/imported-${size}.png`, fullPage: true })
      expect(await reader.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      shots.push({ title: `Imported discussion — ${size}`, shot: `imported-${size}.png`, status: 'passed' })
    }
    const download = reader.waitForEvent('download')
    await reader.getByRole('link', { name: 'diagnostic.html', exact: true }).click()
    expect((await download).suggestedFilename()).toBe('diagnostic.html')
    const manifest = JSON.parse(readFileSync(`${artifactDir}/testrun.json`, 'utf8'))
    manifest.tests.push({ id: 'imported-discussion', title: 'Legacy comment continuation, provenance and protected downloads', status: 'passed', steps: shots })
    writeFileSync(`${artifactDir}/testrun.json`, JSON.stringify(manifest, null, 2))
    writeFileSync(`${artifactDir}/report.html`, readFileSync(`${artifactDir}/report.html`, 'utf8').replace('</html>', `${shots.map(shot => `<section><h2>${shot.title}</h2><img alt="${shot.title}" src="data:image/png;base64,${readFileSync(`${artifactDir}/${shot.shot}`).toString('base64')}"></section>`).join('')}</html>`))
  }
  finally { await context.close() }
})
