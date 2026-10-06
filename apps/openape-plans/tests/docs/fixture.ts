import type { Locator } from '@playwright/test'
import { expect, test } from 'test2docs/playwright'

export { expect, test }

/**
 * Fill a field and make sure the value survived. Typing into a page that has
 * rendered but not hydrated leaves the DOM value in place while v-model never
 * sees it — the field looks filled and the submit button stays disabled.
 */
export async function fillStable(field: Locator, value: string): Promise<void> {
  await expect(async () => {
    await field.fill(value)
    await expect(field).toHaveValue(value)
  }).toPass({ timeout: 15_000 })
}
