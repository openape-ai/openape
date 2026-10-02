import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { chromium } from 'playwright'
import { expect } from 'vitest'

export async function verifyBrowserWorkspace(url: string, email: string, loginToken: string, networkName?: string) {
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
    if (networkName) {
      await page.getByRole('button').filter({ hasText: networkName }).click()
      await page.locator('.graph-node').first().waitFor()
      expect(await page.getByRole('button', { name: 'Process now', exact: true }).count()).toBe(0)
      await mkdir(resolve('.artifacts'), { recursive: true })
      await page.screenshot({ path: resolve('.artifacts/network-browser-authenticated-structure.png'), fullPage: true })
      await page.getByRole('button', { name: 'Recent recorded activity', exact: true }).click()
      await page.getByText('Item accepted', { exact: false }).waitFor()
      await page.setViewportSize({ width: 390, height: 950 })
      expect(await page.locator('html').evaluate(element => element.scrollWidth)).toBeLessThanOrEqual(390)
      await page.screenshot({ path: resolve('.artifacts/network-browser-authenticated-activity-phone.png'), fullPage: true })
      await page.setViewportSize({ width: 1280, height: 900 })
    }
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
