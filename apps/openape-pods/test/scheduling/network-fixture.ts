import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { vi } from 'vitest'
import type { GraphContract } from '../../src/contracts/graphs'
import type { NetworkCommand, NetworkDraft } from '../../src/contracts/networks'
import type { RunInput } from '../../src/contracts/runs'
import type { AgentRuntime } from '../../src/worker/agent/executor'
import { ResourceRegistry } from '../../src/worker/resources/registry'
import type { RunServices } from '../../src/worker/runs/dispatcher'
import { RunDispatcher } from '../../src/worker/runs/dispatcher'
import { installExample } from '../../src/worker/runs/examples'
import { executeScript } from '../../src/worker/runs/runner'
import { NetworkEngine } from '../../src/worker/scheduling/network-engine'
import { PodDatabase, digest } from '../../src/worker/storage/database'
import { PodGroups } from '../../src/worker/workspace/groups'

export interface NetworkItem { eventId: string, key: string, channel: string, data: Record<string, unknown>, caseId: string, caseRevision: number }
export type NetworkBehaviour = (items: NetworkItem[], request: (operation: string, payload: unknown) => Promise<unknown>, input: RunInput, signal: AbortSignal) => Promise<void>
const stores: PodDatabase[] = []
export function closeNetworks(): void {
  for (const store of stores.splice(0)) { store.close(); rmSync(store.root, { recursive: true, force: true }) }
}

export function networkFixture(services?: RunServices) {
  const store = new PodDatabase(mkdtempSync(join(tmpdir(), 'pods-network-run-'))); stores.push(store)
  const resources = new ResourceRegistry(store, () => {})
  vi.spyOn(resources, 'capture').mockResolvedValue({ id: randomUUID(), files: [] } as never)
  const dispatcher = new RunDispatcher(store, resources, { helper: '/unused', environment: {} } as AgentRuntime, services)
  const owner = { issuer: 'https://identity.example.invalid', subject: 'synthetic-network-owner' }
  const engine = new NetworkEngine(store, dispatcher, resources, '/unused', () => owner)
  const groups = new PodGroups(store)
  groups.execute({ type: 'organize', action: 'create', name: 'Synthetic network company', revision: groups.view().revision })
  const groupId = groups.view().groups.at(-1)!.id
  store.db.prepare('INSERT INTO network_owners VALUES(?,?)').run(owner.issuer, owner.subject)
  store.db.prepare('UPDATE settings SET concurrency=4 WHERE id=1').run()
  const behaviours = new Map<string, NetworkBehaviour>(); const contracts = new Map<string, GraphContract>(); const started: string[] = []
  vi.mocked(executeScript).mockImplementation(async (_runtime, _directory, _artifact, input, signal, hooks) => {
    started.push(input.podId)
    const request = (operation: string, payload: unknown) => hooks.request(operation, payload, signal)
    const items = await request('graph.contract', contracts.get(input.podId)) as NetworkItem[]
    await behaviours.get(input.podId)!(items, request, input, signal)
    signal.throwIfAborted()
    return { status: 'completed', summary: 'Synthetic network work completed', completedInputIds: input.eventIds, gapIds: [] }
  })
  function pod(name: string, contract: GraphContract, behaviour: NetworkBehaviour): string {
    const pod = store.createPod({ name })
    groups.execute({ type: 'organize', action: 'move', podId: pod.id, groupId, revision: groups.view().revision })
    installExample(store, resources, pod.id, 'deterministic', 'a'.repeat(64))
    const previous = store.db.prepare('SELECT manifest FROM scripts WHERE pod_id=?').get(pod.id)!
    const manifest = JSON.parse(previous.manifest as string)
    const code = `export const contract=${JSON.stringify(contract)};\nexport async function run(context) { return {status:'completed',summary:'Synthetic fixture',completedInputIds:context.input.eventIds,gapIds:[]}; }\n`
    const hash = digest(code)
    store.storeScript(pod.id, { ...manifest, contentHash: hash, contract }, code)
    const definitionId = randomUUID()
    store.transaction(() => {
      store.db.prepare('UPDATE pods SET active_script=?,lifecycle=\'active\' WHERE id=?').run(hash, pod.id)
      store.db.prepare('INSERT OR REPLACE INTO validations VALUES(?,?,?,?,?)').run(pod.id, hash, pod.bindingRevision, resources.epoch(pod.id), JSON.stringify({ synthetic: true, realStoreAndDispatcher: true, processMocked: true }))
      store.db.prepare('INSERT INTO pod_definitions VALUES(?,?,?,?,?)').run(definitionId, owner.issuer, owner.subject, name, Date.now())
      store.db.prepare('INSERT INTO pod_definition_versions VALUES(?,1,?,?,?,?)').run(definitionId, hash, manifest.dependencyLockHash, JSON.stringify(contract), Date.now())
      store.db.prepare('INSERT INTO instance_definition_bindings VALUES(?,?,1,1)').run(pod.id, definitionId)
    })
    contracts.set(pod.id, contract); behaviours.set(pod.id, behaviour)
    return pod.id
  }
  function create(members: NetworkDraft['members'], names: string[], gates?: NetworkDraft['gates']): string {
    return engine.execute({ type: 'create', draft: { name: 'Synthetic persistent network', groupId, members, ...(gates === undefined ? {} : { gates }), channels: names.map(name => ({ name, title: name, schemaVersion: 1, schema: { type: 'object', properties: { subject: { type: 'string' } }, required: ['subject'], additionalProperties: false } })) } }).createdId!
  }
  function process(id: string, podIds: string[], pausedPodIds: string[] = [], budget = 10) {
    const preview = engine.execute({ type: 'preview', id, revision: 1, podIds, pausedPodIds, budget } satisfies NetworkCommand).preview!
    return engine.execute({ type: 'process', id, revision: 1, previewId: preview.id })
  }
  return { store, resources, dispatcher, engine, owner, groupId, pod, create, process, started, behaviours }
}
