import type { Page } from 'playwright'

const labels = { en: { list: 'List', details: 'Open page' }, de: { list: 'Liste', details: 'Seite öffnen' } }

// A list row opens the Pod directly.
export async function openPod(page: Page, name: string | RegExp, language: keyof typeof labels = 'en') {
  await page.getByRole('button', { name: labels[language].list, exact: true }).click()
  await page.getByRole('row').filter({ hasText: name }).first().click()
}
