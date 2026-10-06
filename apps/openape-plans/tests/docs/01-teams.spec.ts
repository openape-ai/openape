import { expect, fillStable, test } from './fixture'

test.use({
  docMeta: {
    category: 'teams',
    title: 'Create a team',
    description: 'A team is where your plans live and who can see them',
  },
})

test('create a team', async ({ page, doc }) => {
  doc.section('Creating a team', 'A new account starts with no teams. This is the first thing to do.')

  await page.goto('/teams')
  // Wait for the loaded list, not just the heading — the heading is on screen
  // while the teams are still being fetched, and a screenshot taken then shows
  // nothing but "Loading…".
  await expect(page.getByRole('link', { name: 'Create your first team' })).toBeVisible()
  await doc.step({
    action: 'Open Teams',
    description: 'Every team you belong to is listed here.',
    shot: '01-teams-empty',
  })

  await page.getByRole('link', { name: 'Create your first team' }).click()
  await fillStable(page.getByLabel('Name'), 'Product')
  await fillStable(page.getByLabel('Description'), 'Everything we ship this quarter')
  await doc.step({
    action: 'Name the team',
    description: 'The description is optional and helps others recognise the team.',
    shot: '02-team-form',
  })

  await page.getByRole('button', { name: 'Create team' }).click()
  await expect(page.getByRole('heading', { name: 'Product' })).toBeVisible()
  await doc.step({
    action: 'Select Create team',
    description: 'The team opens, ready for its first plan.',
    shot: '03-team-created',
  })
})

test('invite people to the team', async ({ page, doc }) => {
  doc.section('Inviting people', 'Share a link and anyone who opens it joins the team.')

  await page.goto('/teams')
  await page.getByRole('link', { name: 'Product' }).click()
  await expect(page.getByRole('heading', { name: 'Product' })).toBeVisible()

  await page.getByRole('button', { name: /Invite/i }).first().click()
  await expect(page.getByRole('button', { name: /New invite/i })).toBeVisible()
  await doc.step({
    action: 'Choose Invites',
    description: 'Invite links are listed with how often they may still be used.',
    shot: '01-invites',
  })
})
