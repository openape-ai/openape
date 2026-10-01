import { mkdir } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { cleanupAfterEach, launch, retainsCompleteUnit, seed } from './fixtures/crash'

// Termination cases are split across two files so they run on separate workers.
cleanupAfterEach()
describe('checkpoint recovery in Electron', () => {
  it.each(['worker', 'app'] as const)('retains a complete unit through %s termination and retries without duplication', target => retainsCompleteUnit(target))
})

it('validates the network command through the actual Electron preload, main and worker route', async () => {
  const { root } = await seed()
  const { page } = await launch(root, false)
  expect(await page.evaluate(() => window.pods.networks({ type: 'list' }))).toEqual({ networks: [] })
  await expect(page.evaluate(() => window.pods.networks({ type: 'list', owner: 'forged' } as never))).rejects.toThrow('Invalid network definition fields')
  expect((await page.evaluate(() => window.pods.getStatus())).worker.state).toBe('ready')
  await page.getByText('Checkpoint recovery', { exact: true }).first().waitFor()
  await mkdir('.artifacts', { recursive: true })
  await page.screenshot({ path: '.artifacts/network-route.png', fullPage: true })
})
