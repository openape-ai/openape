import { setTimeout as delay } from 'node:timers/promises'
import { describe, expect, it } from 'vitest'
import { PodDatabase } from '../src/worker/storage/database'
import { cleanupAfterEach, launch, seed } from './fixtures/crash'

cleanupAfterEach()
describe('checkpoint recovery in Electron', () => {
  it('pauses intake during a suspend signal and coalesces missed slots on resume', async () => {
    const { root, podId } = await seed(); const { app, page } = await launch(root, true)
    await page.evaluate(podId => window.pods.runs({ type: 'installExample', podId, variant: 'deterministic' }), podId)
    await page.evaluate(podId => window.pods.scheduling({ type: 'save', podId, revision: 0, spec: { kind: 'interval', seconds: 60 }, enabled: true }), podId)
    await page.evaluate(podId => window.pods.scheduling({ type: 'lifecycle', podId, revision: 1, lifecycle: 'active' }), podId)
    await app.evaluate(({ powerMonitor }) => powerMonitor.emit('suspend'))
    await delay(100)
    const store = new PodDatabase(root)
    try { store.db.prepare('UPDATE schedules SET next_at=? WHERE pod_id=?').run(Date.now() - 600000, podId) }
    finally { store.close() }
    await delay(1200)
    expect((await page.evaluate(podId => window.pods.runs({ type: 'list', podId }), podId)).runs).toHaveLength(0)
    await app.evaluate(({ powerMonitor }) => powerMonitor.emit('resume'))
    await expect.poll(async () => (await page.evaluate(podId => window.pods.runs({ type: 'list', podId }), podId)).runs[0]?.state, { timeout: 10000 }).toBe('completed')
    await delay(1200)
    expect((await page.evaluate(podId => window.pods.runs({ type: 'list', podId }), podId)).runs).toHaveLength(1)
    expect((await page.evaluate(() => window.pods.workspace({ type: 'pauseAll' }))).pods[0]!.lifecycle).toBe('paused')
  })
})
