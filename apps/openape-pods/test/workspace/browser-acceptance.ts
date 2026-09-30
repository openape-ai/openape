import { chromium } from 'playwright'
import { expect } from 'vitest'

export async function verifyBrowserWorkspace(url: string, email: string, loginToken: string) {
  const browser = await chromium.launch()
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'en-US' })
    const login = await context.request.post(`${url}/workspace-auth/login`, { headers: { origin: url }, data: { email } })
    expect(login.status()).toBe(200)
    const { redirectUrl } = await login.json() as { redirectUrl: string }
    const authorization = await fetch(redirectUrl, { redirect: 'manual', headers: { authorization: `Bearer ${loginToken}` } })
    expect(authorization.status).toBe(302)
    const page = await context.newPage()
    const failures: string[] = []
    page.on('pageerror', error => failures.push(error.message))
    await page.goto(authorization.headers.get('location')!)
    await expect.poll(async () => ({ errors: failures, content: (await page.locator('body').textContent())?.slice(0, 2000), ready: await page.getByRole('heading', { name: 'Networks & workflows', exact: true }).isVisible() }), { timeout: 15000 }).toMatchObject({ errors: [], ready: true })
    expect(await page.locator('.account-status').textContent()).toContain(email)
    await page.getByRole('button', { name: 'Pods', exact: true }).click()
    await page.locator('.central-pod').first().click()
    for (const name of ['Overview', 'Script', 'Variables and secrets', 'Permissions', 'Settings', 'History']) {
      await page.getByRole('tab', { name, exact: true }).click()
      await expect.poll(async () => (await page.locator('[role="alert"]:visible').allTextContents()).join(' ')).toBe('')
    }
    await page.getByRole('button', { name: 'App settings', exact: true }).click()
    await page.locator('.app-settings').waitFor()
    await page.getByRole('button', { name: 'Sign out', exact: true }).click()
    await page.locator('.pods-welcome').waitFor()
    expect(failures).toEqual([])
  }
  finally { await browser.close() }
}
