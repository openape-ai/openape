import { assignedSsh } from '../../contracts/ssh'
import { assignedJev, parseJevRequest, syntheticJevResult } from '../../contracts/jev'
import { parseWorkflowOutput } from '../../contracts/workflows'
import { parseAgentRequest } from '../../contracts/agent'
import { DependencyStore } from '../dependencies/store'
import { resolveProgram } from '../../main/programs/session'
import { programRequest } from '../../main/programs/invoke'
import { parseHttpRequest, isHttpEffect } from '../../contracts/http'
import { assignedHttp } from '../../main/programs/http-service'
import { PodVariables } from '../resources/variables'
import { parseCredentialRead } from '../../contracts/credentials'
import { ScriptCredentials } from '../resources/script-credentials'
import { mkdir, writeFile, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { PodDatabase, digest, parseManifest } from '../storage/database'
import type { ScriptManifest } from '../storage/database'
import { canonicalNetworkJson } from '../../contracts/network-json'
import { executeScript } from '../runs/runner'
import { parseProgress } from '../runs/progress'
import { inputSchema, resultSchema } from '../runs/examples'
import type { AgentRuntime } from '../agent/executor'
import type { ResourceRegistry } from '../resources/registry'
import { assignedMail } from '../../main/mail/assigned'
import { parseMailRequest } from '../../main/mail/contract'
import { graphEmitter, parseGraphContract, syntheticGraphItems } from '../../contracts/graphs'
import type { GraphContract } from '../../contracts/graphs'

export async function validateDraft(store: PodDatabase, resources: ResourceRegistry, runtime: AgentRuntime, draftId: string, revision: number, signal: AbortSignal, proposedVariables?: Record<string, string>): Promise<{ hash: string, evidence: string }> {
  const draft = store.db.prepare('SELECT * FROM script_drafts WHERE id=? AND revision=?').get(draftId, revision)
  if (!draft) throw new Error('Draft changed; reload before validation')
  const variableState = JSON.stringify(new PodVariables(store).list(draft.pod_id as string))
  const variables = proposedVariables ?? new PodVariables(store).values(draft.pod_id as string)
  const variablesHash = digest(JSON.stringify(Object.entries(variables).sort()))
  const pod = store.getPod(draft.pod_id as string); const epoch = resources.epoch(pod.id)
  if (draft.assignment_revision !== pod.bindingRevision) throw new Error('Script binding changed; save a new draft revision')
  const capabilities = JSON.parse(draft.capabilities as string) as string[]
  const assignedTools = resources.list(pod.id).filter(resource => resource.kind === 'tool' && resource.state === 'ready').map(resource => resource.configuration.capability)
  if (capabilities.some(capability => capability.startsWith('tool.') && !assignedTools.includes(capability))) throw new Error('No tool assignments are available for this script')
  if (capabilities.includes('mail.read')) assignedMail(resources.list(pod.id))
  const manifest = JSON.parse(await readFile(runtime.manifest, 'utf8')) as { dependencyLockHash: string }
  const dependencies = new DependencyStore(store); const packages = dependencies.manifest(draftId)
  const dependencyHash = dependencies.prepared(pod.id, packages)
  if (Object.keys(packages.dependencies).length && !dependencyHash) throw new Error('Prepare dependencies in Script before validation')
  const dependencyRoot = dependencyHash ? await dependencies.verify(pod.id, dependencyHash) : undefined
  const dependencyLockHash = dependencyHash ? digest(`${manifest.dependencyLockHash}:${dependencyHash}`) : manifest.dependencyLockHash
  const definition = store.db.prepare(`SELECT v.content_hash,v.lock_hash,s.manifest FROM definition_update_drafts d
    JOIN pod_definition_versions v ON v.definition_id=d.definition_id AND v.version=d.definition_version
    JOIN pod_definition_sources s ON s.definition_id=v.definition_id AND s.version=v.version
    WHERE d.draft_id=? AND d.pod_id=? AND s.state='published'`).get(draftId, pod.id)
  const pinned = definition ? parseManifest(JSON.parse(definition.manifest as string)) : undefined
  if (pinned && (digest(draft.code as string) !== definition!.content_hash || canonicalNetworkJson(capabilities) !== canonicalNetworkJson(pinned.capabilities))) throw new Error('Definition code or requested rights changed; prepare its immutable version again')
  if (pinned && dependencyLockHash !== definition!.lock_hash) throw new Error('Definition requires a different runtime or dependency lock. Validate and publish a new version for this runtime before updating instances.')
  const code = pinned ? draft.code as string : `${draft.code as string}\n/* Pods binding: assignment ${pod.bindingRevision}; dependencies ${dependencyLockHash}; capabilities ${capabilities.join(',')} */\n`
  const hash = digest(code)
  const root = join(store.root, 'validation', randomUUID())
  await mkdir(root, { recursive: true, mode: 0o700 }); const artifact = join(root, 'run.mjs'); await writeFile(artifact, code, { mode: 0o400, flag: 'wx' })
  const fixture = new PodDatabase(join(root, 'control'))
  const fixturePod = fixture.createPod({ name: 'Validation fixture' })
  try {
    const home = join(root, 'home'); await mkdir(home, { mode: 0o700 })
    const input = { home, directories: [], variables, version: 1 as const, runId: randomUUID(), podId: pod.id, scriptHash: hash, assignmentRevision: pod.bindingRevision, reason: 'manual' as const, eventIds: [], checkpointRevision: 0, checkpoint: {}, resourceEpoch: epoch, workspace: join(root, 'workspace'), references: [], limits: { timeMs: 5000, frameBytes: 256 * 1024 } }
    let contract: GraphContract | undefined; let refusedEmit: Error | undefined
    let checkEmit = graphEmitter(contract)
    const checked = executeScript({ ...runtime, dependencyRoot }, root, artifact, input, signal, { event: () => {}, request: async (operation, payload) => {
      if (operation === 'graph.contract') {
        if (contract) throw new Error('Invalid graph contract')
        contract = parseGraphContract(payload); checkEmit = graphEmitter(contract)
        return syntheticGraphItems(contract)
      }
      if (operation === 'graph.emit') {
        try { checkEmit(payload); return { emitted: true } }
        catch (error) { refusedEmit ??= error as Error; throw error }
      }
      if (operation === 'workflow.publish') { parseWorkflowOutput(payload); return { published: true } }
      if (operation === 'mail.archive') throw new Error('Archive proposals require live provider data; synthetic validation never creates grants or moves mail')
      if (operation === 'mail.workflow.filter') return { complete: true, output: { schema: 'mail-filter-result/v1', batchId: 'synthetic', mailbox: 'fixture@example.invalid', baseline: true, mode: 'preview', retained: [], archived: [], reportReceipts: [] } }
      if (operation === 'mail.workflow.remaining') return { baseline: true, complete: true, messages: [] }
      if (operation === 'mail.workflow.notify') return { delivered: true }
      if (operation === 'credentials.get') {
        const alias = parseCredentialRead(payload)
        new ScriptCredentials(store, resources).readable(pod.id, alias)
        return `synthetic-credential-${alias}`
      }
      if (operation === 'jev.evaluate') {
        const assignment = assignedJev(resources.list(pod.id), pod.id, capabilities)
        return syntheticJevResult(parseJevRequest(payload), assignment.model)
      }
      if (operation === 'http.request') {
        assignedHttp(resources.list(pod.id), { podId: pod.id, capabilities }, parseHttpRequest(payload))
        return { status: 200, headers: { 'content-type': 'application/json' }, body: '{}' }
      }
      if (operation === 'progress.commit') return { revision: fixture.commitProgress({ ...parseProgress(payload), podId: fixturePod.id }) }
      if (operation === 'mail.next' && capabilities.includes('mail.read')) return { type: 'done' }
      if (operation === 'agent.run') {
        parseAgentRequest(payload)
        return { threadId: 'synthetic-validation', response: '{"claims":[]}' }
      }
      if (operation === 'tools.invoke' && payload && typeof payload === 'object' && 'sshInventory' in payload) {
        assignedSsh(resources.list(pod.id), pod.id, capabilities, payload)
        throw new Error('Synthetic validation has no SSH host observations; handle collection failures explicitly')
      }
      if (operation === 'tools.invoke' && payload && typeof payload === 'object' && ('applicationId' in payload || 'application' in payload)) {
        const { assignment, argv } = programRequest(resources.list(pod.id), pod.id, capabilities, payload)
        await resolveProgram(assignment, pod.id, argv, true)
        const argument = (name: string) => argv[argv.indexOf(name) + 1]
        const output = assignment.cliId === 'o365-cli' && argv[0] === 'mail' && argv[1] === 'list' ? [] : assignment.cliId === 'o365-cli' ? { account: argument('--account'), operation: argument('--operation'), items: [], complete: true, nextCursor: null } : {}
        return { exitCode: 0, stdout: JSON.stringify(output), stderr: '' }
      }
      if (operation === 'tools.invoke' && capabilities.includes('mail.read')) {
        const scope = assignedMail(resources.list(pod.id)).mail
        const { read } = parseMailRequest(payload, scope)
        return { version: 1, operation: read.operation, account: scope.account, folder: read.folder, items: [], complete: true, nextCursor: null }
      }
      throw new Error('Validation rejected an undeclared service request')
    } })
    // A script may swallow or rephrase the refusal; the refusal itself decides.
    await Promise.allSettled([checked])
    if (refusedEmit) throw refusedEmit
    const result = await checked
    if (!['completed', 'completedWithGaps'].includes(result.status)) throw new Error('Draft did not complete its synthetic contract check')
    if (result.gapIds.some(id => !fixture.db.prepare('SELECT 1 FROM claims WHERE pod_id=? AND id=? AND kind=\'gap\'').get(fixturePod.id, id))) throw new Error('Draft returned an uncommitted validation gap')
    signal.throwIfAborted()
    const evidence = JSON.stringify({ kind: 'native-synthetic-contract', variablesHash, draftRevision: revision, assignmentRevision: pod.bindingRevision, resourceEpoch: epoch, dependencyLockHash, services: 'synthetic credentials, empty synthetic mail and recorded agent output', limits: input.limits, result: result.status })
    store.transaction(() => {
      if (JSON.stringify(new PodVariables(store).list(pod.id)) !== variableState) throw new Error('Variables changed during validation; validate again')
      if (store.getPod(pod.id).lifecycle === 'archived' || store.getPod(pod.id).bindingRevision !== pod.bindingRevision || resources.epoch(pod.id) !== epoch || store.db.prepare('SELECT revision FROM script_drafts WHERE id=?').get(draftId)?.revision !== revision) throw new Error('Draft, script binding or permissions changed during validation')
      const checkedManifest: ScriptManifest = { schemaVersion: 1, contentHash: hash, entrypoint: 'run.mjs', dependencyLockHash, runtimeVersion: 'electron-40.9.3/codex-0.153.4/contract-1', capabilities, triggers: ['manual', 'schedule', 'event'], inputSchemaHash: digest(JSON.stringify(inputSchema)), outputSchemaHash: digest(JSON.stringify(resultSchema)), checkpointSchemaVersion: 1, assignmentRevision: pod.bindingRevision, ...contract ? { contract } : {}, effects: resources.list(pod.id).some(resource => resource.state === 'ready' && resource.configuration.type === 'http' && capabilities.includes(String(resource.configuration.capability)) && (resource.configuration.methods as string[]).some(isHttpEffect)) ? 'reconciledEffects' : 'readOnly' }
      if (pinned && pinned.effects !== checkedManifest.effects) throw new Error('Instance HTTP effect permissions differ from the definition. Review this instance’s permissions before validating again.')
      if (pinned && canonicalNetworkJson({ ...pinned, assignmentRevision: pod.bindingRevision }) !== canonicalNetworkJson(checkedManifest)) throw new Error('Definition contract or runtime requirements changed; publish a new version')
      store.storeScript(pod.id, pinned ? { ...pinned, assignmentRevision: pod.bindingRevision } : checkedManifest, code)
      if (dependencyHash) store.db.prepare('INSERT OR IGNORE INTO script_dependencies VALUES(?,?,?)').run(pod.id, hash, dependencyHash)
      store.db.prepare('INSERT OR REPLACE INTO validations VALUES(?,?,?,?,?)').run(pod.id, hash, pod.bindingRevision, epoch, evidence)
      store.db.prepare('UPDATE script_drafts SET script_hash=?,validation=? WHERE id=? AND revision=?').run(hash, evidence, draftId, revision)
    })
    return { hash, evidence }
  }
  finally { fixture.close() }
}
