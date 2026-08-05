import { expect, test } from './fixture'

test.use({
  docMeta: {
    category: 'nests',
    title: 'Your devices',
    description: 'A nest is a device that runs the agents doing your company\'s work',
  },
})

test('see your nests', async ({ page, doc }) => {
  doc.section('The nest list', 'Every device you have connected reports in here.')

  await page.goto('/nests')
  await expect(page.getByRole('heading', { name: 'No nest connected yet' })).toBeVisible()
  await doc.step({
    action: 'Open Nests',
    description: 'Until the first device is connected, the page explains how to start one.',
    shot: '01-nests-empty',
  })
})
