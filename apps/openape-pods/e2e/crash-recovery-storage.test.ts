import { rm, truncate, writeFile } from 'node:fs/promises'
import { setTimeout as delay } from 'node:timers/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { cleanupAfterEach, launch, seed } from './fixtures/crash'

cleanupAfterEach()
describe('checkpoint recovery in Electron', () => {
  it('stops an active run at the sampled storage limit and retains its last checkpoint', async () => {
    const { root, podId } = await seed(); const { page } = await launch(root, true)
    await page.evaluate(() => window.pods.data({ type: 'limit', bytes: 1024 ** 3 }))
    await page.evaluate(podId => window.pods.runs({ type: 'start', podId }), podId)
    await expect.poll(async () => (await page.evaluate(podId => window.pods.details({ type: 'list', podId }), podId)).checkpointRevision, { timeout: 10000 }).toBe(1)
    expect((await page.evaluate(() => window.pods.data({ type: 'status' }))).busy).toBe(true)
    await delay(2200)
    const path = join(root, 'pods', podId, 'workspace', 'synthetic-sparse-file'); await writeFile(path, ''); await truncate(path, 1024 ** 3)
    await expect.poll(async () => (await page.evaluate(podId => window.pods.runs({ type: 'list', podId }), podId)).runs[0]?.state, { timeout: 15000 }).toBe('cancelled')
    expect((await page.evaluate(podId => window.pods.details({ type: 'list', podId }), podId)).checkpointRevision).toBe(1)
    expect((await page.evaluate(() => window.pods.data({ type: 'status' }))).error).toContain('limit reached')
    await rm(path); expect((await page.evaluate(() => window.pods.data({ type: 'status' }))).error).toBeNull()
  })
})
