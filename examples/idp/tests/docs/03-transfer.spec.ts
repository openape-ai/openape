import { expect, test } from './fixture'

test.use({
  docMeta: {
    category: 'transfer',
    title: 'Sign in on another browser',
    description: 'Bring your session to a browser that cannot use passkeys',
  },
})

test('create a sign-in link', async ({ page, doc }) => {
  doc.section('Handing over a session', 'Useful for kiosks, embedded browsers and agent panes.')

  await page.goto('/account')
  await expect(page.getByRole('button', { name: 'Create sign-in link' })).toBeVisible()
  await doc.step({
    action: 'Find "Sign in on another browser"',
    description: 'The card sits at the bottom of your account page.',
    shot: '01-card',
  })

  await page.getByRole('button', { name: 'Create sign-in link' }).click()
  // The caption promises a link and a code, so wait for both to be on screen —
  // clicking alone leaves the button spinning over an empty card.
  await expect(page.getByRole('button', { name: 'Copy link' })).toBeVisible()
  await expect(page.locator('.qr svg')).toBeVisible()
  await doc.step({
    action: 'Select Create sign-in link',
    description: 'Paste the link in the other browser, or scan the code with a phone. It works once, for 60 seconds.',
    shot: '02-link',
  })
})
