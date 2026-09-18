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
