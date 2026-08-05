import { expect, fillStable, test } from './fixture'

test.use({
  docMeta: {
    category: 'companies',
    title: 'Create a company',
    description: 'A company gives your agents a direction to work towards',
  },
})

test('create a company', async ({ page, doc }) => {
  doc.section('Creating a company', 'A new account starts with no companies. This is the first thing to do.')

  await page.goto('/companies')
  await expect(page.getByRole('button', { name: 'Create company' })).toBeVisible()
  await doc.step({
    action: 'Open Companies',
    description: 'Every company you run is listed here.',
    shot: '01-companies-empty',
  })

  await page.getByRole('button', { name: 'Create company' }).click()
  await fillStable(page.getByPlaceholder('Company name'), 'Northwind')
  await fillStable(
    page.getByPlaceholder('What should this company achieve?'),
    'Ship a reliable billing product that support never has to apologise for.',
  )
  await doc.step({
    action: 'Name the company and write its vision',
    description: 'The Operator reads the vision on every interaction, so write it for a colleague.',
    shot: '02-company-form',
  })

  await page.getByRole('button', { name: 'Create', exact: true }).click()
  await expect(page.getByText('Northwind').first()).toBeVisible()
  await doc.step({
    action: 'Select Create',
    description: 'The company appears in the list, ready to be opened.',
    shot: '03-company-created',
  })
})

test('open the company', async ({ page, doc }) => {
  doc.section('Inside a company', 'The company page shows its hierarchy and what it is working on.')

  await page.goto('/companies')
  await page.getByText('Northwind').first().click()
  await expect(page).toHaveURL(/\/companies\/.+/)
  await doc.step({
    action: 'Select the company',
    description: 'Its people, objectives and budget are on one page.',
    shot: '01-company-detail',
  })
})
