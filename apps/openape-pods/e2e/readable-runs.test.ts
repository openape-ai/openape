import { _electron as electron } from 'playwright'
import { mkdtemp, realpath, rm, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { expect, it } from 'vitest'
import { fixtureDirectory } from '../src/main/fixture'
import { PodDatabase } from '../src/worker/storage/database'
import { RunStore } from '../src/worker/runs/store'

it('readable run activity: renders actual persisted states and safe environment in both languages', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'pods-readable-runs-'))); fixtureDirectory(root)
  const setup = new PodDatabase(root); const pod = setup.createPod({ name: 'Synthetic digest' }); setup.close()
  const app = await electron.launch({ executablePath: resolve('release/mac-arm64/OpenApe Pods Fixture.app/Contents/MacOS/OpenApe Pods Fixture'), env: { HOME: root, TMPDIR: tmpdir(), PATH: '/usr/bin:/bin', OPENAPE_PODS_FIXTURE_DIR: root, NODE_ENV: 'test' } })
  let store: PodDatabase | undefined
  try {
    const page = await app.firstWindow(); page.setDefaultTimeout(7000)
    await expect.poll(async () => (await page.evaluate(() => window.pods.getStatus())).worker.state).toBe('ready')
    store = new PodDatabase(root)
    const runs = new RunStore(store)
    const id = randomUUID(); const hash = 'a'.repeat(64); const start = Date.now() - 65000
    store.db.prepare('INSERT INTO runs(id,pod_id,script_hash,state,started_at,finished_at,summary,error,checkpoint_revision,assignment_revision) VALUES(?,?,?,\'failed\',?,?,?, ?,0,1)').run(id, pod.id, hash, start, Date.now(), 'Script did not finish', 'Identity authorization failed (400)')
    runs.append(id, 'started', { reason: 'manual' })
    runs.append(id, 'operation', { id: 'app-call', operation: 'tools.invoke', state: 'failed' })
    runs.append(id, 'finished', { state: 'failed' })
    await mkdir(resolve('.artifacts/readable-runs'), { recursive: true })
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setContentSize(1100, 950))
    for (const language of ['en', 'de'] as const) {
      await page.evaluate(language => window.pods.language({ type: 'set', language }), language); await page.reload()
      await page.getByRole('tab', { name: language === 'en' ? 'History' : 'Historie', exact: true }).click()
      await page.locator('.run-result .run-problem').waitFor()
      expect(await page.locator('.run-result .run-problem').textContent()).toContain(language === 'en' ? 'permission service' : 'nicht autorisiert')
      expect(await page.locator('.event-list').isVisible()).toBe(false)
      expect(await page.locator('.run-steps').textContent()).not.toContain(language === 'en' ? 'AI request' : 'KI-Anfrage')
      await page.screenshot({ path: resolve(`.artifacts/readable-runs/failed-${language}.png`), fullPage: true })
    }
    const storageId = randomUUID()
    store.db.prepare('INSERT INTO runs(id,pod_id,script_hash,state,started_at,finished_at,summary,error,checkpoint_revision,assignment_revision) VALUES(?,?,?,\'cancelled\',?,?,\'\',?,0,1)').run(storageId, pod.id, hash, Date.now(), Date.now(), 'Data inventory contains a link or unsupported file: runs/fixture/agent/confined/home/codex/tmp/arg0/fixture/apply_patch')
    runs.append(storageId, 'started', { reason: 'manual' })
    for (let index = 0; index < 5; index++) {
      runs.append(storageId, 'operation', { id: `synthetic-${index}`, operation: 'tools.invoke', state: 'started' })
      runs.append(storageId, 'approval', { grantId: `synthetic-${index}`, title: 'Read synthetic mail', issuer: 'https://id.example.test', permission: 'o365.account[email=synthetic@example.invalid].mail-read[*]#read', state: 'approved' })
      runs.append(storageId, 'operation', { id: `synthetic-${index}`, operation: 'tools.invoke', state: 'completed' })
    }
    runs.append(storageId, 'operation', { id: 'ai-call', operation: 'agent.run', state: 'started' })
    await expect.poll(() => page.locator('.run-result .run-problem').textContent(), { timeout: 7000 }).toContain('Speicherprüfung')
    expect(await page.getByRole('button', { name: 'Berechtigungen prüfen', exact: true }).count()).toBe(0)
    expect(await page.locator('.run-steps li').count()).toBe(2)
    expect(await page.locator('.run-steps').textContent()).toContain('5 erfolgreich')
    await page.screenshot({ path: resolve('.artifacts/readable-runs/storage-de.png'), fullPage: true })
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setContentSize(680, 850))
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: resolve('.artifacts/readable-runs/storage-de-narrow.png'), fullPage: true })
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setContentSize(1100, 950))
    const currentId = randomUUID()
    store.db.prepare('INSERT INTO runs(id,pod_id,script_hash,state,started_at,summary,checkpoint_revision,assignment_revision) VALUES(?,?,?,\'running\',?,\'\',0,1)').run(currentId, pod.id, hash, Date.now())
    runs.append(currentId, 'started', { reason: 'manual' })
    runs.append(currentId, 'approval', { grantId: 'synthetic-grant', issuer: 'https://id.example.test', subject: 'pod@example.test', state: 'pending', title: 'Run the stored script of Synthetic digest', permission: `pod-runtime.pod[id=${pod.id}]#run`, openError: 'The browser could not be opened; use Open approval to try again' })
    await page.locator('.approval-card').waitFor()
    expect(await page.getByRole('button', { name: 'Freigabe öffnen', exact: true }).count()).toBe(1)
    await page.screenshot({ path: resolve('.artifacts/readable-runs/waiting-de.png'), fullPage: true })
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setContentSize(600, 850))
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: resolve('.artifacts/readable-runs/waiting-de-narrow.png'), fullPage: true })
    runs.append(currentId, 'approval', { grantId: 'synthetic-grant', issuer: 'https://id.example.test', state: 'approved', title: 'Run the stored script' })
    store.db.prepare('UPDATE runs SET state=\'completed\',finished_at=?,summary=\'Synthetic run completed\' WHERE id=?').run(Date.now(), currentId)
    runs.append(currentId, 'finished', { state: 'completed' })
    await expect.poll(() => page.locator('.approval-card').count()).toBe(0)
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setContentSize(1100, 950))
    await page.screenshot({ path: resolve('.artifacts/readable-runs/completed-de.png'), fullPage: true })
    await page.getByRole('tab', { name: 'Skript', exact: true }).click()
    const environment = page.locator('details').filter({ hasText: 'HOME' }); await environment.locator('summary').click()
    expect(await environment.textContent()).toContain('PODS_POD_ID')
    expect(await environment.textContent()).not.toContain('SYNTHETIC_TOKEN')
    await page.screenshot({ path: resolve('.artifacts/readable-runs/environment-de.png'), fullPage: true })
    expect(store.db.prepare('SELECT count(*) AS count FROM schedules WHERE enabled=1').get()?.count).toBe(0)
  }
  finally { store?.close(); await app.close(); await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }) }
})
