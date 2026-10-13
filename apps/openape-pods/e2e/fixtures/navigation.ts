import type { Page } from 'playwright'

const labels = { en: { list: 'List', details: 'Open details' }, de: { list: 'Liste', details: 'Details öffnen' } }

// The desktop opens on the Automatisierungen landing; a Pod's own pages open from its detail panel.
export async function openPod(page: Page, name: string | RegExp, language: keyof typeof labels = 'en') {
  await page.getByRole('button', { name: labels[language].list, exact: true }).click()
  await page.getByRole('row').filter({ hasText: name }).first().click()
  await page.getByRole('button', { name: labels[language].details, exact: true }).click()
}
