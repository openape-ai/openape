import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { expect, it } from 'vitest'
import { cleanupAfterEach, launch, seed } from './fixtures/crash'
import { fixtureShellIdentity } from './fixtures/shell-identity'
import { PodDatabase } from '../src/worker/storage/database'
import { ResourceRegistry } from '../src/worker/resources/registry'
import { installExample } from '../src/worker/runs/examples'
import { PodGroups } from '../src/worker/workspace/groups'
import { podDirectories } from '../src/runtime/environment'

cleanupAfterEach()
it('definition native boundary: isolates identities and validates exact versions with explicit provisioning recovery', async () => {
  const { root, podId } = await seed()
  const identity = await fixtureShellIdentity(root, [], false, true)
  const store = new PodDatabase(root)
  const runtime = JSON.parse(await readFile(resolve('dist/vendor/manifest.json'), 'utf8'))
  installExample(store, new ResourceRegistry(store, () => {}), podId, 'deterministic', runtime.dependencyLockHash)
  store.db.prepare('UPDATE pods SET name=\'Reusable source\' WHERE id=?').run(podId)
  store.db.prepare('INSERT INTO remote_registration VALUES(1,?,0)').run(JSON.stringify({ id: randomUUID(), generation: randomUUID(), owner: identity.owner }))
  const groups = new PodGroups(store)
  for (const name of ['Synthetic Company A', 'Synthetic Company B']) groups.execute({ type: 'organize', action: 'create', name, revision: groups.view().revision })
  const companyIds = groups.view().groups.map(group => group.id)
  const sourceHash = store.getPod(podId).activeScript!
  const sourceHome = (await podDirectories(root, podId)).home
  await writeFile(join(sourceHome, 'owner-private.txt'), 'SYNTHETIC_SOURCE_ONLY')
  store.close()
  const inspect = <T>(read: (database: PodDatabase) => T): T => {
    const database = new PodDatabase(root); try { return read(database) }
    finally { database.close() }
  }
  const { app, page } = await launch(root, false, identity)
  const published = await page.evaluate(({ podId, sourceHash }) => window.pods.definitions({ type: 'publish', podId, expectedScript: sourceHash, name: 'Reusable example', defaults: { label: 'Version one' } }), { podId, sourceHash })
  const definitionId = published.instances.find(item => item.podId === podId)!.definitionId
  const firstRequest = randomUUID(); identity.failNextEnrollment()
  await expect(page.evaluate(({ requestId, definitionId, groupId }) => window.pods.definitions({ type: 'instantiate', requestId, definitionId, version: 2, name: 'Company A instance', groupId }), { requestId: firstRequest, definitionId, groupId: companyIds[0]! })).rejects.toThrow('retained for provisioning retry')
  const pending = (await page.evaluate(() => window.pods.definitions({ type: 'list' }))).provisioning.find(item => item.requestId === firstRequest)!
  expect(pending.state).toBe('failed')
  const first = await page.evaluate(requestId => window.pods.definitions({ type: 'retryProvision', requestId }), firstRequest)
  expect(first.createdPodId).toBe(pending.podId)
  const second = await page.evaluate(({ requestId, definitionId, groupId }) => window.pods.definitions({ type: 'instantiate', requestId, definitionId, version: 2, name: 'Company B instance', groupId }), { requestId: randomUUID(), definitionId, groupId: companyIds[1]! })
  const instanceIds = [first.createdPodId!, second.createdPodId!]
  expect(new Set(instanceIds).size).toBe(2)
  for (const instanceId of instanceIds) {
    expect(await readdir((await podDirectories(root, instanceId)).home)).toEqual([])
    const result = await page.evaluate(async (podId) => {
      const scripts = await window.pods.scripts({ type: 'list', podId })
      if (!scripts.source || scripts.source.kind !== 'draft') throw new Error('Missing isolated definition draft')
      const checked = await window.pods.scripts({ type: 'validate', podId, revision: scripts.pod.revision, draftId: scripts.source.id, draftRevision: scripts.source.revision })
      await window.pods.definitions({ type: 'activateUpdate', podId, draftId: scripts.source.id, expectedBinding: 1 })
      return { hash: checked.source!.hash, evidence: checked.source!.evidence }
    }, instanceId)
    expect(result.hash).toBe(sourceHash)
    expect(JSON.parse(result.evidence!).kind).toBe('native-synthetic-contract')
  }
  const newer = await page.evaluate(async (podId) => {
    const current = await window.pods.scripts({ type: 'list', podId })
    const draft = await window.pods.scripts({ type: 'save', podId, revision: current.pod.revision, draftId: null, draftRevision: 0, code: `${current.source!.code}\n// Updated reusable example\n`, capabilities: [] })
    const checked = await window.pods.scripts({ type: 'validate', podId, revision: draft.pod.revision, draftId: draft.source!.id, draftRevision: draft.source!.revision })
    await window.pods.scripts({ type: 'activate', podId, revision: checked.pod.revision, hash: checked.source!.hash!, expectedActive: current.pod.activeScript })
    return window.pods.definitions({ type: 'publish', podId, expectedScript: checked.source!.hash!, name: 'Reusable example', defaults: { label: 'Version two' } })
  }, podId)
  expect(newer.definitions.find(item => item.id === definitionId)!.versions).toHaveLength(3)
  const updated = await page.evaluate(async ({ podId, definitionId }) => {
    const prepared = await window.pods.definitions({ type: 'prepareUpdate', podId, definitionId, version: 3, expectedBinding: 2 })
    const scripts = await window.pods.scripts({ type: 'list', podId, selection: { kind: 'draft', id: prepared.update!.draftId! } })
    await window.pods.scripts({ type: 'validate', podId, revision: scripts.pod.revision, draftId: scripts.source!.id, draftRevision: scripts.source!.revision })
    return window.pods.definitions({ type: 'activateUpdate', podId, draftId: scripts.source!.id, expectedBinding: 2 })
  }, { podId: instanceIds[0]!, definitionId })
  expect(updated.instances.find(item => item.podId === instanceIds[0])!.version).toBe(3)
  expect(updated.instances.find(item => item.podId === instanceIds[1])!.version).toBe(2)
  const evidence = inspect((database) => {
    const identities = instanceIds.map(id => JSON.parse(database.db.prepare('SELECT identity FROM remote_pods WHERE pod_id=?').get(id)!.identity as string))
    expect(new Set(identities.map(item => item.subject)).size).toBe(2)
    expect(new Set(identities.map(item => item.keyId)).size).toBe(2)
    for (const id of instanceIds) {
      expect(database.db.prepare('SELECT * FROM resources WHERE pod_id=?').all(id)).toEqual([])
      expect(database.db.prepare('SELECT * FROM script_credential_approvals WHERE pod_id=?').all(id)).toEqual([])
      expect(database.checkpoint(id)).toEqual({ revision: 0, body: {} })
      expect(database.getPod(id).lifecycle).toBe('paused')
    }
    expect(database.db.prepare('SELECT enabled FROM remote_registration').get()!.enabled).toBe(0)
    expect(database.db.prepare('SELECT count(*) AS count FROM scripts WHERE pod_id=?').get(instanceIds[0]!)!.count).toBe(2)
    return { route: 'Actual Electron preload/main/worker/native sandbox with a local synthetic identity provider', instances: updated.instances, identities: identities.map(item => ({ podId: item.podId, subject: item.subject, keyId: item.keyId })), provisioning: updated.provisioning, attempts: identity.enrollmentAttempts(), remoteAccessEnabled: false, sourceHomeUncopied: true, resourcesAndCredentialApprovalsCopied: 0 }
  })
  expect(evidence.attempts).toHaveLength(3)
  expect(evidence.attempts[0]).toEqual(evidence.attempts[1])
  await page.getByRole('button', { name: 'Pods', exact: true }).click()
  await page.getByRole('button', { name: /Company B instance/ }).click()
  await page.getByRole('tab', { name: 'Script', exact: true }).click()
  await page.locator('.definition-panel summary').click()
  await page.getByRole('button', { name: 'Review update for this instance', exact: true }).click()
  await page.getByRole('heading', { name: 'Definition update review', exact: true }).waitFor()
  await mkdir(resolve('.artifacts'), { recursive: true })
  await page.locator('.definition-panel summary').evaluate(element => element.scrollIntoView({ block: 'start' }))
  await page.screenshot({ path: resolve('.artifacts/definitions-desktop.png') })
  await page.getByRole('heading', { name: 'Definition update review', exact: true }).evaluate(element => element.scrollIntoView({ block: 'start' }))
  await page.screenshot({ path: resolve('.artifacts/definitions-review.png') })
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(430, 900))
  await page.evaluate(() => window.pods.language({ type: 'set', language: 'de' }))
  await page.reload()
  await page.getByRole('button', { name: 'Pods', exact: true }).click()
  await page.getByRole('button', { name: /Company B instance/ }).click()
  await page.getByRole('tab', { name: 'Skript', exact: true }).click()
  await page.locator('.definition-panel summary').click()
  await page.getByRole('button', { name: 'Update für diese Instanz prüfen', exact: true }).click()
  await page.getByRole('heading', { name: 'Versionswechsel prüfen', exact: true }).waitFor()
  await page.locator('.definition-panel summary').evaluate(element => element.scrollIntoView({ block: 'start' }))
  await page.screenshot({ path: resolve('.artifacts/definitions-narrow.png') })
  await page.getByRole('heading', { name: 'Versionswechsel prüfen', exact: true }).evaluate(element => element.scrollIntoView({ block: 'start' }))
  await page.screenshot({ path: resolve('.artifacts/definitions-narrow-review.png') })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await writeFile(resolve('.artifacts/definitions-native.json'), JSON.stringify(evidence, null, 2))
}, 120000)
