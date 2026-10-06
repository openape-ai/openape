import { expect, fillStable, test } from './fixture'

test.use({
  docMeta: {
    category: 'plans',
    title: 'Write a plan',
    description: 'Plans are markdown documents your team works from',
  },
})

test('write a plan', async ({ page, doc }) => {
  doc.section('Writing a plan', 'Plans belong to a team and are visible to everyone in it.')

  await page.goto('/teams')
  await page.getByRole('link', { name: 'Product' }).click()
  await page.getByRole('link', { name: /New plan/i }).click()

  await fillStable(page.getByLabel('Title'), 'Move billing to the new API')
  await fillStable(page.getByLabel(/Body/), '# Overview\n\n- Goal: one billing path\n- Approach: migrate per customer\n')
  await doc.step({
    action: 'Give the plan a title and a body',
    description: 'The body is markdown — headings and lists render in the plan view.',
    shot: '01-plan-form',
  })

  await page.getByRole('button', { name: /Create plan/i }).click()
  await expect(page.getByRole('heading', { name: 'Move billing to the new API' })).toBeVisible()
  await doc.step({
    action: 'Select Create plan',
    description: 'The plan opens with its rendered markdown.',
    shot: '02-plan-created',
  })

  doc.section('Finding it again', 'Plans stay with their team.')

  await page.goto('/teams')
  await page.getByRole('link', { name: 'Product' }).click()
  await expect(page.getByRole('link', { name: 'Move billing to the new API' })).toBeVisible()
  await doc.step({
    action: 'Open the team',
    description: 'Every plan of the team is listed with its status.',
    shot: '01-team-plans',
  })
})
