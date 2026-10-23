import { assertCurrentScript } from '../../contracts/retired-storage'
import { parseNotify } from '../inbox/outbox'
import { assignedSsh } from '../../contracts/ssh'
import { assignedJev, parseJevRequest, syntheticJevResult } from '../../contracts/jev'
import { parseAgentRequest } from '../../contracts/agent'
import { AgentCallError } from '../../contracts/agent-errors'
import { DependencyStore } from '../dependencies/store'
import { verifyProgram } from '../../main/programs/session'
import { programRequest } from '../../main/programs/invoke'
import { parseHttpRequest, isHttpEffect } from '../../contracts/http'
import { splitScriptSummary } from '../../contracts/grant-summary'
import { parseGrantWithdrawRequest } from '@openape/grants'
import { assignedHttp } from '../../main/programs/http-service'
import { PodVariables } from '../resources/variables'
import { parseCredentialRead } from '../../contracts/credentials'
import { ScriptCredentials } from '../resources/script-credentials'
import { mkdir, writeFile, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { PodDatabase, digest, parseManifest } from '../storage/database'
import type { ScriptManifest } from '../storage/database'
import { canonicalJson } from '../../contracts/canonical-json'
import { executeScript } from '../runs/runner'
import { ownerScriptAuthority } from '../runs/owner-script'
import { parseProgress } from '../runs/progress'
import { inputSchema, resultSchema } from '../runs/examples'
import type { AgentRuntime } from '../agent/executor'
import type { ResourceRegistry } from '../resources/registry'
import { assertImportSetupFinished } from '../sharing/setup'
import type { ScriptResult } from '../../contracts/runs'
import { assertTimingRequest } from '../../contracts/runs'

/** Validation is a contract smoke check: any well-formed result passes, unless the script ended unsuccessfully after a refused service request. */
function assertValidationResult(result: ScriptResult, refusal: Error | undefined): void {
  if (['completed', 'completedWithGaps'].includes(result.status) || !refusal) return
  throw new Error(`Draft returned ${result.status} after validation refused a service request: ${refusal.message}`)
}

export async function validateDraft(store: PodDatabase, resources: ResourceRegistry, runtime: AgentRuntime, draftId: string, revision: number, signal: AbortSignal): Promise<{ hash: string, evidence: string, status: ScriptResult['status'] }> {
  const draft = store.db.prepare('SELECT * FROM script_drafts WHERE id=? AND revision=?').get(draftId, revision)
  if (!draft) throw new Error('Draft changed; reload before validation')
  assertCurrentScript(String(draft.code))
  assertImportSetupFinished(store, draft.pod_id as string)
  const variableState = JSON.stringify(new PodVariables(store).list(draft.pod_id as string))
  const variables = new PodVariables(store).values(draft.pod_id as string)
  const variablesHash = digest(JSON.stringify(Object.entries(variables).sort()))
  const pod = store.getPod(draft.pod_id as string); const epoch = resources.epoch(pod.id)
  if (draft.assignment_revision !== pod.bindingRevision) throw new Error('Script binding changed; save a new draft revision')
  const capabilities = JSON.parse(draft.capabilities as string) as string[]
  const assignedTools = resources.list(pod.id).filter(resource => resource.kind === 'tool' && resource.state === 'ready').map(resource => resource.configuration.capability)
  if (capabilities.some(capability => capability.startsWith('tool.') && !assignedTools.includes(capability))) throw new Error('No tool assignments are available for this script')
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
  if (pinned && (digest(draft.code as string) !== definition!.content_hash || canonicalJson(capabilities) !== canonicalJson(pinned.capabilities))) throw new Error('Definition code or requested rights changed; prepare its immutable version again')
  if (pinned && dependencyLockHash !== definition!.lock_hash) throw new Error('Definition requires a different runtime or dependency lock. Validate and publish a new version for this runtime before updating instances.')
  const code = pinned ? draft.code as string : `${draft.code as string}\n/* Pods binding: assignment ${pod.bindingRevision}; dependencies ${dependencyLockHash}; capabilities ${capabilities.join(',')} */\n`
  const hash = digest(code)
  const root = join(store.root, 'validation', randomUUID())
  await mkdir(root, { recursive: true, mode: 0o700 }); const artifact = join(root, 'run.mjs'); await writeFile(artifact, code, { mode: 0o400, flag: 'wx' })
  const fixture = new PodDatabase(join(root, 'control'))
  const fixturePod = fixture.createPod({ name: 'Validation fixture' })
  let preparation: Awaited<ReturnType<NonNullable<AgentRuntime['prepareExecution']>>> | undefined
  try {
    preparation = await runtime.prepareExecution?.(pod.id, 'validation', signal)
    const home = join(root, 'home'); await mkdir(home, { mode: 0o700 })
    const input = { home, directories: [], variables, version: 1 as const, runId: randomUUID(), podId: pod.id, scriptHash: hash, assignmentRevision: pod.bindingRevision, reason: 'manual' as const, eventIds: [], checkpointRevision: 0, checkpoint: {}, resourceEpoch: epoch, workspace: join(root, 'workspace'), references: [], limits: { timeMs: 5000, frameBytes: 256 * 1024 }, validation: true as const }
    let refusal: Error | undefined
    const startedAt = Date.now()
    const synthetic = async (operation: string, input: unknown): Promise<unknown> => {
      if (operation === 'run.timing') {
        assertTimingRequest(input)
        return { activeMs: Math.max(0, Date.now() - startedAt), waitingMs: 0 }
      }
      // A summary of a tool or HTTP call is checked like at run time and leaves the call itself unchanged.
      const { payload } = operation === 'tools.invoke' || operation === 'http.request' ? splitScriptSummary(input) : { payload: input }
      if (operation === 'notify') { parseNotify(payload); return { eventId: `${pod.id}:synthetic`, queued: false } }
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
      if (operation === 'agent.run') {
        const request = parseAgentRequest(payload)
        if (request.backend === 'proxy') {
          if (!runtime.validateProxyAgent) throw new AgentCallError('proxy_not_configured', 'Proxy agent backend is not configured', { phase: 'resolve' })
          await runtime.validateProxyAgent(request, signal)
        }
        return { threadId: 'synthetic-validation', response: '{"claims":[]}' }
      }
      if (operation === 'tools.invoke' && payload && typeof payload === 'object' && 'approval' in payload) throw new Error('Approved commands need a live owner approval; synthetic validation never consumes approvals or runs them')
      if (operation === 'tools.invoke' && payload && typeof payload === 'object' && 'sshInventory' in payload) {
        assignedSsh(resources.list(pod.id), pod.id, capabilities, payload)
        throw new Error('Synthetic validation has no SSH host observations; handle collection failures explicitly')
      }
      if (operation === 'tools.invoke' && payload && typeof payload === 'object' && ('applicationId' in payload || 'application' in payload)) {
        const { assignment } = programRequest(resources.list(pod.id), pod.id, capabilities, payload)
        // Synthetic validation checks the assigned program; what its command may do is decided by the IdP when it runs.
        await verifyProgram(assignment)
        throw new Error('Synthetic validation has no application observations; handle context.input.validation before invoking tools')
      }
      // Synthetic validation has no IdP requests, so no reference is known.
      if (operation === 'tools.withdraw') { parseGrantWithdrawRequest(payload); return { outcome: 'unknown' } }
      throw new Error('Validation rejected an undeclared service request')
    }
    let executing = !preparation
    const result = await executeScript({ ...runtime, dependencyRoot, ...(preparation ? { machine: preparation.machine } : {}) }, root, artifact, input, signal, {
      authorizeStart: async () => {
        signal.throwIfAborted()
        if (store.getPod(pod.id).bindingRevision !== pod.bindingRevision || resources.epoch(pod.id) !== epoch || store.db.prepare('SELECT revision FROM script_drafts WHERE id=?').get(draftId)?.revision !== revision) throw new Error('Validation inputs changed during execution')
        if (dependencyHash) await dependencies.verify(pod.id, dependencyHash)
        return ownerScriptAuthority(input, `${draftId}:${revision}:${hash}`)
      },
      event: () => {},
      budgetPaused: () => !executing,
      ...(preparation
        ? {
            execution: {
              authorized: async () => {
                signal.throwIfAborted()
                if (store.getPod(pod.id).bindingRevision !== pod.bindingRevision || resources.epoch(pod.id) !== epoch || store.db.prepare('SELECT revision FROM script_drafts WHERE id=?').get(draftId)?.revision !== revision) throw new Error('Validation inputs changed during approval')
                if (dependencyHash) await dependencies.verify(pod.id, dependencyHash)
                executing = true
              },
            },
          }
        : {}),
      request: async (operation, payload) => {
        try { return await synthetic(operation, payload) }
        catch (error) {
        // A script may swallow or rephrase the refusal; the first refusal is what validation reports.
          refusal ??= error instanceof Error ? error : new Error('Validation refused a service request')
          throw error
        }
      },
    })
    assertValidationResult(result, refusal)
    if (result.gapIds.some(id => !fixture.db.prepare('SELECT 1 FROM claims WHERE pod_id=? AND id=? AND kind=\'gap\'').get(fixturePod.id, id))) throw new Error('Draft returned an uncommitted validation gap')
    signal.throwIfAborted()
    const evidence = JSON.stringify({ kind: 'native-synthetic-contract', variablesHash, draftRevision: revision, assignmentRevision: pod.bindingRevision, resourceEpoch: epoch, dependencyLockHash, services: 'synthetic credentials and recorded agent output; external observations are unavailable', limits: input.limits, result: result.status, summary: result.summary.slice(0, 500) })
    store.transaction(() => {
      if (JSON.stringify(new PodVariables(store).list(pod.id)) !== variableState) throw new Error('Variables changed during validation; validate again')
      if (store.getPod(pod.id).lifecycle === 'archived' || store.getPod(pod.id).bindingRevision !== pod.bindingRevision || resources.epoch(pod.id) !== epoch || store.db.prepare('SELECT revision FROM script_drafts WHERE id=?').get(draftId)?.revision !== revision) throw new Error('Draft, script binding or permissions changed during validation')
      const checkedManifest: ScriptManifest = { schemaVersion: 1, contentHash: hash, entrypoint: 'run.mjs', dependencyLockHash, runtimeVersion: 'electron-40.9.3/codex-0.153.4/contract-1', capabilities, triggers: ['manual', 'schedule', 'event'], inputSchemaHash: digest(JSON.stringify(inputSchema)), outputSchemaHash: digest(JSON.stringify(resultSchema)), checkpointSchemaVersion: 1, assignmentRevision: pod.bindingRevision, effects: resources.list(pod.id).some(resource => resource.state === 'ready' && resource.configuration.type === 'http' && capabilities.includes(String(resource.configuration.capability)) && (resource.configuration.methods as string[]).some(isHttpEffect)) ? 'reconciledEffects' : 'readOnly' }
      if (pinned && pinned.effects !== checkedManifest.effects) throw new Error('Instance HTTP effect permissions differ from the definition. Review this instance’s permissions before validating again.')
      if (pinned && canonicalJson({ ...pinned, assignmentRevision: pod.bindingRevision }) !== canonicalJson(checkedManifest)) throw new Error('Definition contract or runtime requirements changed; publish a new version')
      store.storeScript(pod.id, pinned ? { ...pinned, assignmentRevision: pod.bindingRevision } : checkedManifest, code)
      if (dependencyHash) store.db.prepare('INSERT OR IGNORE INTO script_dependencies VALUES(?,?,?)').run(pod.id, hash, dependencyHash)
      store.db.prepare('INSERT OR REPLACE INTO validations VALUES(?,?,?,?,?)').run(pod.id, hash, pod.bindingRevision, epoch, evidence)
      store.db.prepare('UPDATE script_drafts SET script_hash=?,validation=? WHERE id=? AND revision=?').run(hash, evidence, draftId, revision)
    })
    return { hash, evidence, status: result.status }
  }
  finally { await preparation?.close(); fixture.close() }
}
