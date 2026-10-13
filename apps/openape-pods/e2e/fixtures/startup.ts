import type { Page } from 'playwright'
import { readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { expect } from 'vitest'

// A new profile takes a verified automatic backup on the worker's first idle tick (issue 1465);
// the worker refuses other commands until it finishes, so a fresh launch waits for it.
export async function startupBackup(page: Page, root: string) {
  const status = async () => {
    try { return JSON.parse(await readFile(join(root, 'automatic-backup.json'), 'utf8')) as unknown }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error }
  }
  await expect.poll(status, { timeout: 20000 }).toMatchObject({ lastSuccessAt: expect.any(Number), lastError: null })
  await expect.poll(async () => (await page.evaluate(() => window.pods.data({ type: 'status' }))).busy).toBe(false)
}

/** Automatic backups land next to the profile, outside the fixture root. */
export async function removeProfile(root: string) {
  await Promise.all([root, `${root} Backups`].map(path => rm(path, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })))
}
