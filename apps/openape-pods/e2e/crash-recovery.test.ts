import { PodDatabase } from '../src/worker/storage/database'
import { schema53Shared } from '../src/worker/storage/schema53-shared'
import { mkdir } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { cleanupAfterEach, launch, retainsCompleteUnit, seed } from './fixtures/crash'
import { openPod } from './fixtures/navigation'

// Termination cases are split across two files so they run on separate workers.
cleanupAfterEach()
describe('checkpoint recovery in Electron', () => {
  it.each(['worker', 'app'] as const)('retains a complete unit through %s termination and retries without duplication', target => retainsCompleteUnit(target), 120000)
})

it('migrates a schema-53 profile and serves preserved approvals through the actual Electron route', async () => {
  const { root } = await seed()
  const before = new PodDatabase(root)
  const pod = before.listPods()[0]!
  before.db.exec(`${schema53Shared}INSERT INTO data_sequence VALUES(1,0); PRAGMA user_version=53`)
  before.db.prepare('INSERT INTO action_approvals(id,pod_id,action,object,payload,payload_hash,title,authority,state,created_at,updated_at) VALUES(\'history\',?,\'mail.archive\',\'mail\',\'{}\',?,\'Retained history\',\'{}\',\'collecting\',1,1)').run(pod.id, 'a'.repeat(64))
  before.close()
  const { page } = await launch(root, false)
  expect(await page.evaluate(() => window.pods.approvalHistory({ type: 'list' }))).toMatchObject({ approvals: [{ id: 'history', title: 'Retained history', batchUrl: null }] })
  await expect(page.evaluate(() => window.pods.approvalHistory({ type: 'list', owner: 'forged' } as never))).rejects.toThrow('Unsupported data fields')
  expect((await page.evaluate(() => window.pods.getStatus())).worker.state).toBe('ready')
  await openPod(page, 'Checkpoint recovery')
  await page.getByRole('heading', { name: 'Checkpoint recovery' }).waitFor()
  await mkdir('.artifacts', { recursive: true })
  await page.screenshot({ path: '.artifacts/approval-history-route.png', fullPage: true })
})
