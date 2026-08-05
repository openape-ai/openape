import { expect, test } from './fixture'

test.use({
  docMeta: {
    category: 'account',
    title: 'Account & security',
    description: 'Everything tied to your identity in one place',
  },
})

test('review your account', async ({ page, doc }) => {
  doc.section('The account hub', 'Passkeys, SSH keys and the services you signed in to.')

  await page.goto('/account')
  await expect(page.getByRole('heading', { name: 'Account & security' })).toBeVisible()
  await doc.step({
    action: 'Open Account & security',
    description: 'Each card opens the list behind it.',
    shot: '01-account',
  })

  await page.getByText('Passkeys').first().click()
  await expect(page).toHaveURL(/passkeys/)
  await doc.step({
    action: 'Choose Passkeys',
    description: 'Every device you can sign in with is listed, and can be removed here.',
    shot: '02-passkeys',
  })
})
