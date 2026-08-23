import { MANAGEMENT_TOKEN } from 'openape-e2e/constants'
import { APP_URL } from './constants'
import { attachVirtualAuthenticator, expect, fillStable, test } from './fixture'

// A newcomer arrives with no session at all — the saved one from globalSetup
// would skip exactly the pages this guide is about.
test.use({
  storageState: { cookies: [], origins: [] },
  docMeta: {
    category: 'register',
    title: 'Register and sign in',
    description: 'Your passkey replaces the password — it never leaves your device',
  },
})

const NEWCOMER = 'newcomer@example.com'

test('register a passkey and sign in with it', async ({ context, page, doc }) => {
  await attachVirtualAuthenticator(context, page)

  const created = await context.request.post(`${APP_URL}/api/admin/registration-urls`, {
    headers: { Authorization: `Bearer ${MANAGEMENT_TOKEN}` },
    data: { email: NEWCOMER, name: 'Newcomer', expiresInHours: 48 },
  })
  expect(created.ok(), await created.text()).toBe(true)
  const { registrationUrl } = await created.json() as { registrationUrl: string }

  doc.section('Registering', 'You get a one-time registration link by mail. It sets up this device.')

  await page.goto(registrationUrl)
  await expect(page.getByRole('button', { name: 'Register Passkey' })).toBeEnabled()
  await fillStable(page.getByPlaceholder('e.g. MacBook, iPhone'), 'MacBook')
  await doc.step({
    action: 'Open the registration link and name this device',
    description: 'The name helps you recognise the device later among your passkeys.',
    shot: '01-register-form',
  })

  await page.getByRole('button', { name: 'Register Passkey' }).click()
  await page.waitForURL(url => !url.pathname.startsWith('/register'), { timeout: 30_000 })
  await doc.step({
    action: 'Select Register Passkey and confirm on your device',
    description: 'Your device asks for a fingerprint, face or PIN. The key stays on the device.',
    shot: '02-registered',
  })
})
