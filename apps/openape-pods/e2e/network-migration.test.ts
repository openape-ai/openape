import { mkdir, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { expect, it, vi } from 'vitest'
import { cleanupAfterEach, launch, seed } from './fixtures/crash'
import { fixtureShellIdentity } from './fixtures/shell-identity'
import { PodDatabase, digest } from '../src/worker/storage/database'
import { ResourceRegistry } from '../src/worker/resources/registry'
import { installExample } from '../src/worker/runs/examples'
import { DefinitionCatalog } from '../src/worker/workspace/definition-catalog'
import { PodGroups } from '../src/worker/workspace/groups'
import { WorkflowEngine } from '../src/worker/workflows/engine'

cleanupAfterEach()

it('converts a legacy graph through the desktop with preserved identities and checkpoints and no implicit execution', async () => {
  const { root } = await seed(); const identity = await fixtureShellIdentity(root)
  const store = new PodDatabase(root); const resources = new ResourceRegistry(store, () => {})
  const runtime = JSON.parse(await readFile(resolve('dist/vendor/manifest.json'), 'utf8'))
  const groups = new PodGroups(store)
  groups.execute({ type: 'organize', action: 'create', name: 'Synthetic migration company', revision: groups.view().revision })
  const groupId = groups.view().groups.at(-1)!.id
  const catalog = new DefinitionCatalog(store, resources, identity.owner)
  const members: string[] = []
  for (const [index, name] of ['Legacy source', 'Legacy consumer'].entries()) {
    const pod = store.createPod({ name }); members.push(pod.id)
    groups.execute({ type: 'organize', action: 'move', podId: pod.id, groupId, revision: groups.view().revision })
    installExample(store, resources, pod.id, 'deterministic', runtime.dependencyLockHash)
    const contract = { takes: index ? ['cases'] : [], gives: index ? [] : ['cases'], summary: 'Synthetic portable case intake' }
    const previous = JSON.parse(store.db.prepare('SELECT manifest FROM scripts WHERE pod_id=?').get(pod.id)!.manifest as string)
    const code = `export const contract=${JSON.stringify(contract)}; export async function run(context) { if(context.variables.region!=='AT') throw new Error('Legacy variable was lost'); ${index ? '' : `if(context.network) await context.network.emit({channel:'cases',key:'new-case',sourceItemId:'after-baseline',sourceVersion:'1',payload:{subject:context.variables.region}});`} return {status:'completed',summary:'Synthetic migration settled',completedInputIds:context.input.eventIds,gapIds:[]}; }`
    const hash = digest(code)
    store.storeScript(pod.id, { ...previous, contentHash: hash, contract, capabilities: [] }, code)
    store.db.prepare('UPDATE pods SET active_script=? WHERE id=?').run(hash, pod.id)
    store.db.prepare('INSERT OR REPLACE INTO validations VALUES(?,?,?,?,?)').run(pod.id, hash, pod.bindingRevision, resources.epoch(pod.id), JSON.stringify({ synthetic: true, migration: true }))
    catalog.adopt(pod.id)
    await catalog.publish(pod.id, hash, name, { region: 'AT' })
    store.db.prepare('UPDATE instance_definition_bindings SET definition_version=2 WHERE pod_id=?').run(pod.id)
    store.db.prepare('UPDATE checkpoints SET revision=3,body=? WHERE pod_id=?').run(JSON.stringify({ watermark: index ? 'consumer-reviewed' : 'source-reviewed' }), pod.id)
  }
  const workflowId = randomUUID()
  const workflows = new WorkflowEngine(store, { start: vi.fn(), cancelPod: vi.fn() }, { inspect: vi.fn() })
  workflows.save({ type: 'save', id: workflowId, revision: 0, name: 'Synthetic legacy cases', nodes: members.map(podId => ({ podId, after: [], handoff: false })), schedule: null, enabled: false, mode: 'channels', groupId, channels: [{ name: 'cases', title: 'Cases', fields: ['subject'] }], gates: [], values: [{ name: 'region', value: 'AT', revision: 1 }] })
  store.db.prepare('INSERT INTO schedules VALUES(?,1,?,1,?,NULL)').run(members[0]!, '{"kind":"interval","seconds":3600}', Date.now() + 86400000)
  store.db.prepare('INSERT INTO remote_registration VALUES(1,?,0)').run(JSON.stringify({ owner: identity.owner }))
  const before = { pods: store.db.prepare('SELECT * FROM pods ORDER BY id').all(), scripts: store.db.prepare('SELECT * FROM scripts ORDER BY pod_id,hash').all(), resources: store.db.prepare('SELECT * FROM resources ORDER BY id').all(), checkpoints: store.db.prepare('SELECT * FROM checkpoints ORDER BY pod_id').all() }
  store.close()
  const { app, page } = await launch(root, false, identity)
  await page.getByText('Synthetic legacy cases', { exact: true }).first().click()
  await page.getByRole('button', { name: 'Review graph conversion', exact: true }).click()
  await page.getByRole('button', { name: 'Review values and rights', exact: true }).click()
  await page.getByRole('button', { name: 'Add field', exact: true }).click()
  await page.getByLabel('Field name', { exact: true }).fill('subject')
  await page.getByLabel('Type', { exact: true }).selectOption('string')
  await page.getByLabel('I reviewed each channel schema against the existing scripts and payloads.', { exact: true }).check()
  await page.getByRole('button', { name: 'Preview conversion', exact: true }).click()
  await page.getByRole('button', { name: 'Validate reviewed conversion', exact: true }).waitFor()
  expect(await page.getByRole('button', { name: 'Validate reviewed conversion', exact: true }).isDisabled()).toBe(true)
  const unchanged = new PodDatabase(root)
  try {
    expect(unchanged.db.prepare('SELECT count(*) AS count FROM networks').get()!.count).toBe(0)
    expect(unchanged.db.prepare('SELECT archived FROM workflows WHERE id=?').get(workflowId)!.archived).toBe(0)
    expect(unchanged.db.prepare('SELECT * FROM checkpoints ORDER BY pod_id').all()).toEqual(before.checkpoints)
  }
  finally { unchanged.close() }
  await page.getByRole('button', { name: 'Inspect active script', exact: true }).first().click()
  await page.getByText('Pinned active script', { exact: true }).waitFor()
  expect(await page.locator('.network-conversion pre').allTextContents()).toEqual(expect.arrayContaining([expect.stringContaining('export const contract=')]))
  await page.getByText('Pinned active script', { exact: true }).click()
  for (const name of ['Legacy source', 'Legacy consumer']) await page.getByLabel(`I reviewed the exact checkpoint, script and local rights of ${name}.`, { exact: true }).check()
  await page.getByLabel('Legacy source already emits explicit item IDs and versions with network.emit. Its reviewed baseline excludes historical work.', { exact: true }).check()
  await page.getByRole('button', { name: 'Validate reviewed conversion', exact: true }).click()
  await page.getByText('Review is current. No execution or external action will start.', { exact: true }).waitFor()
  await page.getByText('Inspect retained checkpoint', { exact: true }).first().click()
  await mkdir(resolve('.artifacts'), { recursive: true })
  await page.screenshot({ path: resolve('.artifacts/network-migration-native-review.png'), fullPage: true })
  await page.getByLabel('Disable the old graph and schedules and create this paused network.', { exact: true }).check()
  await page.getByRole('button', { name: 'Convert to paused network', exact: true }).click()
  await page.getByRole('button', { name: 'Activate network', exact: true }).waitFor()
  const verified = new PodDatabase(root)
  try {
    expect(verified.db.prepare('SELECT * FROM pods ORDER BY id').all()).toEqual(before.pods)
    expect(verified.db.prepare('SELECT * FROM scripts ORDER BY pod_id,hash').all()).toEqual(before.scripts)
    expect(verified.db.prepare('SELECT * FROM resources ORDER BY id').all()).toEqual(before.resources)
    expect(verified.db.prepare('SELECT * FROM checkpoints ORDER BY pod_id').all()).toEqual(before.checkpoints)
    expect(verified.db.prepare('SELECT state,ancestor_workflow_id FROM networks').get()).toMatchObject({ state: 'paused', ancestor_workflow_id: workflowId })
    expect(verified.db.prepare('SELECT archived,enabled,paused FROM workflows WHERE id=?').get(workflowId)).toMatchObject({ archived: 1, enabled: 0, paused: 1 })
    expect(verified.db.prepare('SELECT enabled,next_at FROM schedules').get()).toMatchObject({ enabled: 0, next_at: null })
    expect(verified.db.prepare('SELECT pod_id,revision,body FROM network_checkpoints ORDER BY pod_id').all()).toEqual(before.checkpoints.filter(checkpoint => members.includes(checkpoint.pod_id as string)))
    expect(verified.db.prepare('SELECT count(*) AS count FROM network_invocations').get()!.count).toBe(0)
    expect(verified.db.prepare('SELECT count(*) AS count FROM network_events').get()!.count).toBe(0)
  }
  finally { verified.close() }
  await page.screenshot({ path: resolve('.artifacts/network-migration-native-paused.png'), fullPage: true })
  await page.getByRole('button', { name: 'Edit paused composition', exact: true }).click()
  await page.getByLabel('Name', { exact: true }).fill('Reviewed synthetic composition')
  await page.getByRole('button', { name: 'Review values and rights', exact: true }).click()
  await page.getByRole('button', { name: 'Review composition changes', exact: true }).click()
  await page.getByRole('heading', { name: 'Review composition changes', exact: true }).waitFor()
  expect(await page.getByRole('button', { name: 'Save paused composition', exact: true }).isDisabled()).toBe(true)
  await page.screenshot({ path: resolve('.artifacts/network-replacement-native-review.png'), fullPage: true })
  await page.getByLabel('Save these reviewed changes and keep the network paused.', { exact: true }).check()
  await page.getByRole('button', { name: 'Save paused composition', exact: true }).click()
  await page.getByRole('heading', { name: 'Reviewed synthetic composition', exact: true }).waitFor()
  const replaced = new PodDatabase(root)
  try {
    expect(replaced.db.prepare('SELECT name,revision,state FROM networks').get()).toMatchObject({ name: 'Reviewed synthetic composition', revision: 2, state: 'paused' })
    expect(replaced.db.prepare('SELECT * FROM pods ORDER BY id').all()).toEqual(before.pods)
    expect(replaced.db.prepare('SELECT * FROM scripts ORDER BY pod_id,hash').all()).toEqual(before.scripts)
    expect(replaced.db.prepare('SELECT * FROM resources ORDER BY id').all()).toEqual(before.resources)
    expect(replaced.db.prepare('SELECT * FROM checkpoints ORDER BY pod_id').all()).toEqual(before.checkpoints)
    expect(replaced.db.prepare('SELECT count(*) AS n FROM network_invocations').get()!.n).toBe(0)
    expect(replaced.db.prepare('SELECT count(*) AS n FROM network_revisions').get()!.n).toBe(2)
    expect(replaced.db.prepare('SELECT count(*) AS n FROM network_trace_events WHERE kind=\'composition-replaced-reviewed\'').get()!.n).toBe(1)
  }
  finally { replaced.close() }
  await page.screenshot({ path: resolve('.artifacts/network-replacement-native-paused.png'), fullPage: true })
  await page.getByRole('button', { name: 'Process now', exact: true }).click()
  await page.getByRole('checkbox', { name: 'Legacy source paused', exact: true }).check()
  await page.getByLabel('Include paused Pod Legacy source', { exact: true }).check()
  await page.getByLabel('Maximum invocations', { exact: true }).fill('1')
  await page.getByRole('button', { name: 'Preview processing', exact: true }).click()
  await page.getByRole('button', { name: 'Process up to 1', exact: true }).click()
  await expect.poll(async () => {
    const result = new PodDatabase(root)
    try { return result.db.prepare('SELECT payload FROM network_events').all().map(row => JSON.parse(row.payload as string)) }
    finally { result.close() }
  }).toEqual([{ subject: 'AT' }])
  await page.getByRole('button', { name: 'Review archival', exact: true }).click()
  await page.getByText('Resolve pending network deliveries before changing the composition', { exact: true }).waitFor()
  expect(await page.getByRole('button', { name: 'Archive network', exact: true }).count()).toBe(0)
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()
  await page.getByRole('button', { name: 'Process now', exact: true }).click()
  await page.getByRole('checkbox', { name: 'Legacy source paused', exact: true }).uncheck()
  await page.getByRole('checkbox', { name: 'Legacy consumer paused', exact: true }).check()
  await page.getByLabel('Include paused Pod Legacy consumer', { exact: true }).check()
  await page.getByRole('button', { name: 'Preview processing', exact: true }).click()
  await page.getByRole('button', { name: 'Process up to 1', exact: true }).click()
  await expect.poll(async () => {
    const result = new PodDatabase(root)
    try { return result.db.prepare('SELECT count(*) AS n FROM network_deliveries WHERE state!=\'done\'').get()!.n }
    finally { result.close() }
  }).toBe(0)
  await expect.poll(() => page.evaluate(async () => {
    const network = (await window.pods.networks({ type: 'list' })).networks[0]!
    return (await window.pods.networks({ type: 'archivePreview', id: network.id, revision: network.revision })).archiveReview!.issues
  })).toEqual([])
  await page.getByRole('button', { name: 'Review archival', exact: true }).click()
  await expect.poll(() => page.getByText('Waiting: 0 · Processing: 0 · Decisions: 0', { exact: true }).count()).toBe(1)
  await page.getByLabel('Permanently archive this settled network without replay. This cannot be undone.', { exact: true }).check()
  await page.screenshot({ path: resolve('.artifacts/network-archive-native-review.png'), fullPage: true })
  await page.getByRole('button', { name: 'Archive network', exact: true }).click()
  await page.getByText('This network is archived. History and Pod identities remain available; execution cannot resume.', { exact: true }).waitFor()
  expect(await page.getByRole('button', { name: 'Activate network', exact: true }).count()).toBe(0)
  expect(await page.getByRole('button', { name: 'Process now', exact: true }).count()).toBe(0)
  await page.getByRole('button', { name: 'Inspect retained legacy items', exact: true }).click()
  await page.getByText('No retained legacy deliveries on this page.', { exact: true }).waitFor()
  const archived = new PodDatabase(root)
  try {
    expect(archived.db.prepare('SELECT state FROM networks').get()!.state).toBe('archived')
    expect(archived.db.prepare('SELECT * FROM pods ORDER BY id').all()).toEqual(before.pods)
    expect(archived.db.prepare('SELECT count(*) AS n FROM network_events').get()!.n).toBe(1)
    expect(archived.db.prepare('SELECT count(*) AS n FROM network_invocations').get()!.n).toBe(2)
  }
  finally { archived.close() }
  await page.screenshot({ path: resolve('.artifacts/network-archive-native-retained.png'), fullPage: true })
  await app.close()
})
