import { mkdir, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { expect, it } from 'vitest'
import { cleanupAfterEach, launch, seed } from './fixtures/crash'
import { fixtureShellIdentity } from './fixtures/shell-identity'
import { PodDatabase, digest } from '../src/worker/storage/database'
import { ResourceRegistry } from '../src/worker/resources/registry'
import { installExample } from '../src/worker/runs/examples'
import { DefinitionCatalog } from '../src/worker/workspace/definition-catalog'
import { PodGroups } from '../src/worker/workspace/groups'

cleanupAfterEach()

it('creates a paused network through native UI with one retained mailbox and independent timers, then explicitly processes paused sources', async () => {
  const { root } = await seed(); const identity = await fixtureShellIdentity(root)
  const store = new PodDatabase(root); const resources = new ResourceRegistry(store, () => {})
  const runtime = JSON.parse(await readFile(resolve('dist/vendor/manifest.json'), 'utf8'))
  const groups = new PodGroups(store)
  groups.execute({ type: 'organize', action: 'create', name: 'Synthetic operations company', revision: groups.view().revision })
  const groupId = groups.view().groups.at(-1)!.id
  const catalog = new DefinitionCatalog(store, resources, identity.owner)
  const members: string[] = []
  for (const [index, name] of ['Mailbox source', 'Independent timer', 'Case reviewer'].entries()) {
    const pod = store.createPod({ name }); members.push(pod.id)
    groups.execute({ type: 'organize', action: 'move', podId: pod.id, groupId, revision: groups.view().revision })
    installExample(store, resources, pod.id, 'deterministic', runtime.dependencyLockHash)
    if (index === 0) {
      const connectionId = randomUUID()
      resources.replaceMail(pod.id, [
        { kind: 'tool', name: 'Synthetic mailbox · read only', configuration: { capability: 'mail.read', account: 'synthetic@example.invalid', folders: ['inbox'], attachments: false, connectionId, grants: {} } },
        { kind: 'connection', name: 'Synthetic Microsoft connection', configuration: { provider: 'microsoft', connectionId, account: 'synthetic@example.invalid' } },
        { kind: 'connection', name: 'Synthetic Pod identity', configuration: { provider: 'openape', identity: { connectionId: randomUUID(), podId: pod.id, issuer: identity.owner.issuer, owner: identity.owner.subject, subject: `fixture-${index}`, keyId: 'synthetic-key' } } },
      ])
    }
    const contract = { takes: index === 2 ? ['input'] : [], gives: index === 2 ? [] : ['input'], summary: index === 2 ? 'Reviews synthetic cases' : 'Independent synthetic source' }
    const previous = JSON.parse(store.db.prepare('SELECT manifest FROM scripts WHERE pod_id=?').get(pod.id)!.manifest as string)
    const code = `export const contract=${JSON.stringify(contract)}; export async function run(context) { ${index === 2 ? '' : `await context.network.emit({channel:'input',key:'source-${index}',sourceItemId:'source-${index}',sourceVersion:'1',payload:{subject:'Synthetic case'}});`} return {status:'completed',summary:'Synthetic native operations settled',completedInputIds:context.input.eventIds,gapIds:[]}; }`
    const hash = digest(code)
    store.storeScript(pod.id, { ...previous, contentHash: hash, contract, capabilities: index === 0 ? ['mail.read'] : [] }, code)
    store.db.prepare('UPDATE pods SET active_script=? WHERE id=?').run(hash, pod.id)
    store.db.prepare('INSERT OR REPLACE INTO validations VALUES(?,?,?,?,?)').run(pod.id, hash, pod.bindingRevision, resources.epoch(pod.id), JSON.stringify({ synthetic: true, nativeUI: true }))
    catalog.adopt(pod.id)
    await catalog.publish(pod.id, hash, name, index < 2 ? { mailbox: 'synthetic@example.invalid' } : {})
    store.db.prepare('UPDATE instance_definition_bindings SET definition_version=2 WHERE pod_id=?').run(pod.id)
  }
  store.db.prepare('INSERT INTO remote_registration VALUES(1,?,0)').run(JSON.stringify({ owner: identity.owner }))
  const originalResources = store.db.prepare('SELECT * FROM resources WHERE pod_id=? ORDER BY id').all(members[0]!)
  store.close()
  const { app, page } = await launch(root, false, identity)
  await page.getByRole('button', { name: 'Create network', exact: true }).first().click()
  await page.getByRole('button', { name: 'Persistent network', exact: false }).click()
  await page.getByLabel('Name', { exact: true }).fill('Synthetic operational network')
  await page.getByLabel('Company', { exact: true }).selectOption(groupId)
  for (const name of ['Case reviewer', 'Independent timer', 'Mailbox source']) await page.getByLabel(name, { exact: true }).check()
  await page.getByRole('button', { name: 'Review values and rights', exact: true }).click()
  await expect.poll(async () => { const alert = await page.locator('[role=alert]').allTextContents(); if (alert.length) throw new Error(alert.join(' | ')); return page.getByText('Created paused. Activation is a separate action.', { exact: true }).isVisible() }).toBe(true)
  await page.getByLabel('Set shared value for mailbox', { exact: true }).check()
  await page.getByLabel('mailbox', { exact: true }).fill('shared@example.invalid')
  const timers = page.getByLabel('Timer interval in seconds; zero means manual only', { exact: true })
  await timers.nth(0).fill('60'); await timers.nth(1).fill('120')
  await page.getByRole('button', { name: 'Add field', exact: true }).click()
  await page.getByLabel('Field name', { exact: true }).fill('subject')
  await mkdir(resolve('.artifacts'), { recursive: true })
  await page.screenshot({ path: resolve('.artifacts/network-operations-native-review.png'), fullPage: true })
  await page.getByRole('button', { name: 'Create paused network', exact: true }).click()
  await page.getByRole('heading', { name: 'Synthetic operational network', exact: true }).waitFor()
  const view = await page.evaluate(() => window.pods.networks({ type: 'list' }))
  expect(view.networks[0]!.state).toBe('paused')
  const detail = await page.evaluate(id => window.pods.networks({ type: 'detail', id, revision: 1 }), view.networks[0]!.id)
  expect(detail.details!.definition.members.filter(member => member.source).map(member => member.source!.schedule)).toEqual(expect.arrayContaining([{ kind: 'interval', seconds: 60 }, { kind: 'interval', seconds: 120 }]))
  expect(detail.details!.members.flatMap(member => member.values).filter(value => value.name === 'mailbox')).toEqual([expect.objectContaining({ origin: 'composition', value: 'shared@example.invalid' }), expect.objectContaining({ origin: 'composition', value: 'shared@example.invalid' })])
  await page.getByRole('button', { name: 'Activate network', exact: true }).click()
  await page.getByRole('button', { name: 'Pause network', exact: true }).click()
  await page.getByRole('button', { name: 'Process now', exact: true }).click()
  await page.getByRole('checkbox', { name: 'Mailbox source paused', exact: true }).check()
  expect(await page.getByRole('button', { name: 'Preview processing', exact: true }).isDisabled()).toBe(true)
  await page.getByLabel('Include paused Pod Mailbox source', { exact: true }).check()
  await page.getByLabel('Maximum invocations', { exact: true }).fill('1')
  await page.getByRole('button', { name: 'Preview processing', exact: true }).click()
  await page.getByRole('button', { name: 'Process up to 1', exact: true }).press('Enter')
  await expect.poll(async () => (await page.evaluate(id => window.pods.networks({ type: 'trace', id, revision: 1, before: null, caseId: null }), view.networks[0]!.id)).trace!.events.some(event => event.kind === 'invocation-settled')).toBe(true)
  const verified = new PodDatabase(root)
  try {
    expect(verified.db.prepare('SELECT * FROM resources WHERE pod_id=? ORDER BY id').all(members[0]!)).toEqual(originalResources)
    expect(verified.db.prepare('SELECT state FROM network_invocations WHERE pod_id=? ORDER BY rowid DESC LIMIT 1').get(members[0]!)!.state).toBe('completed')
    expect(verified.db.prepare('SELECT count(*) AS count FROM network_events').get()!.count).toBe(1)
    expect(verified.getPod(members[0]!).lifecycle).toBe('paused')
    expect(verified.db.prepare('SELECT state FROM networks').get()!.state).toBe('paused')
  }
  finally { verified.close() }
  await page.screenshot({ path: resolve('.artifacts/network-operations-native-created.png'), fullPage: true })
  await app.close()
})

it('mounts the actual connected desktop entry and refuses network creation while its workspace is offline', async () => {
  const { root } = await seed()
  await mkdir(resolve(root, 'central'), { recursive: true })
  const { app, page } = await launch(root, false)
  await page.getByRole('alert').filter({ hasText: 'Central workspace offline' }).first().waitFor()
  expect(await page.evaluate(() => window.pods.central!({ type: 'status' }))).toMatchObject({ enabled: true, online: false })
  await page.getByRole('button', { name: 'Create network', exact: true }).first().click()
  expect(await page.getByRole('button', { name: 'Persistent network', exact: false }).isDisabled()).toBe(true)
  await page.getByRole('status').filter({ hasText: 'Central workspace offline' }).waitFor()
  await mkdir(resolve('.artifacts'), { recursive: true })
  await page.screenshot({ path: resolve('.artifacts/network-operations-native-connected-offline.png'), fullPage: true })
  await app.close()
})
