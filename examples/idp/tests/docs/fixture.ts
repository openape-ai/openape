import type { BrowserContext, Locator, Page } from '@playwright/test'
import { expect, test } from 'test2docs/playwright'

export { expect, test }

/**
 * Fill a field and make sure the value survived. Typing into a page that has
 * rendered but not hydrated leaves the DOM value in place while v-model never
 * sees it — the field looks filled and the button stays disabled.
 */
export async function fillStable(field: Locator, value: string): Promise<void> {
  await expect(async () => {
    await field.fill(value)
    await expect(field).toHaveValue(value)
  }).toPass({ timeout: 15_000 })
}

/**
 * Give the browser a passkey it can actually use. Chrome has no real
 * authenticator in a headless run, so one is attached over CDP — the same
 * dialogs appear, they just answer themselves. Chromium only.
 */
export async function attachVirtualAuthenticator(context: BrowserContext, page: Page): Promise<void> {
  const cdp = await context.newCDPSession(page)
  await cdp.send('WebAuthn.enable')
  await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: {
      protocol: 'ctap2',
      transport: 'internal',
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  })
}
