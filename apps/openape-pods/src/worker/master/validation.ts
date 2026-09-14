import { parseCredentialRead } from '../../contracts/credentials'
import { ScriptCredentials } from '../resources/script-credentials'
import { mkdir, writeFile, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { PodDatabase, digest } from '../storage/database'
import { executeScript } from '../runs/runner'
import { parseProgress } from '../runs/progress'
import { inputSchema, resultSchema } from '../runs/examples'
import type { AgentRuntime } from '../agent/executor'
import type { ResourceRegistry } from '../resources/registry'
import { assignedMail } from '../../main/mail/assigned'
import { parseMailRequest } from '../../main/mail/contract'

export async function validateDraft(store: PodDatabase, resources: ResourceRegistry, runtime: AgentRuntime, draftId: string, revision: number, signal: AbortSignal): Promise<{ hash: string, evidence: string }> {
  const draft = store.db.prepare('SELECT * FROM script_drafts WHERE id=? AND revision=?').get(draftId, revision)
  if (!draft) throw new Error('Draft changed; reload before validation')
  const pod = store.getPod(draft.pod_id as string); const epoch = resources.epoch(pod.id)
  if (draft.assignment_revision !== pod.revision) throw new Error('Assignment changed; save a new draft revision')
  const capabilities = JSON.parse(draft.capabilities as string) as string[]
  new ScriptCredentials(store, resources).required(pod.id, capabilities)
  if (capabilities.includes('mail.read')) assignedMail(resources.list(pod.id))
  const manifest = JSON.parse(await readFile(runtime.manifest, 'utf8')) as { dependencyLockHash: string }
  const code = `${draft.code as string}\n/* Pods binding: assignment ${pod.revision}; dependencies ${manifest.dependencyLockHash}; capabilities ${capabilities.join(',')} */\n`
  const hash = digest(code)
  const root = join(store.root, 'validation', randomUUID())
  await mkdir(root, { recursive: true, mode: 0o700 }); const artifact = join(root, 'run.mjs'); await writeFile(artifact, code, { mode: 0o400, flag: 'wx' })
  const fixture = new PodDatabase(join(root, 'control'))
  const fixturePod = fixture.createPod({ name: 'Validation fixture', assignment: pod.assignment })
  try {
    const input = { version: 1 as const, runId: randomUUID(), podId: pod.id, scriptHash: hash, assignmentRevision: pod.revision, reason: 'manual' as const, eventIds: [], checkpointRevision: 0, checkpoint: {}, resourceEpoch: epoch, workspace: join(root, 'workspace'), references: [], limits: { timeMs: 5000, frameBytes: 256 * 1024 } }
    const result = await executeScript(runtime, root, artifact, input, signal, { event: () => {}, request: async (operation, payload) => {
      if (operation === 'credentials.get') {
        const alias = parseCredentialRead(payload)
        if (!capabilities.includes(`credential.${alias}`)) throw new Error('Credential capability is not declared by this script')
        return `synthetic-credential-${alias}`
      }
      if (operation === 'progress.commit') return { revision: fixture.commitProgress({ ...parseProgress(payload), podId: fixturePod.id }) }
      if (operation === 'mail.next' && capabilities.includes('mail.read')) return { type: 'done' }
      if (operation === 'agent.run') {
        if (!payload || typeof payload !== 'object' || Array.isArray(payload) || Object.keys(payload).some(key => key !== 'prompt') || typeof (payload as { prompt?: unknown }).prompt !== 'string') throw new Error('Invalid agent request')
        return { threadId: 'synthetic-validation', response: '{"claims":[]}' }
      }
      if (operation === 'tools.invoke' && capabilities.includes('mail.read')) {
        const scope = assignedMail(resources.list(pod.id)).mail
        const { read } = parseMailRequest(payload, scope)
        return { version: 1, operation: read.operation, account: scope.account, folder: read.folder, items: [], complete: true, nextCursor: null }
      }
      throw new Error('Validation rejected an undeclared service request')
    } })
    if (!['completed', 'completedWithGaps'].includes(result.status)) throw new Error('Draft did not complete its synthetic contract check')
    if (result.gapIds.some(id => !fixture.db.prepare('SELECT 1 FROM claims WHERE pod_id=? AND id=? AND kind=\'gap\'').get(fixturePod.id, id))) throw new Error('Draft returned an uncommitted validation gap')
    signal.throwIfAborted()
    const evidence = JSON.stringify({ kind: 'native-synthetic-contract', draftRevision: revision, assignmentRevision: pod.revision, resourceEpoch: epoch, dependencyLockHash: manifest.dependencyLockHash, services: 'synthetic credentials, empty synthetic mail and recorded agent output', limits: input.limits, result: result.status })
    store.transaction(() => {
      if (store.getPod(pod.id).revision !== pod.revision || resources.epoch(pod.id) !== epoch || store.db.prepare('SELECT revision FROM script_drafts WHERE id=?').get(draftId)?.revision !== revision) throw new Error('Draft, assignment or permissions changed during validation')
      store.storeScript(pod.id, { schemaVersion: 1, contentHash: hash, entrypoint: 'run.mjs', dependencyLockHash: manifest.dependencyLockHash, runtimeVersion: 'electron-40.9.3/codex-0.153.4/contract-1', capabilities, triggers: ['manual', 'schedule', 'event'], inputSchemaHash: digest(JSON.stringify(inputSchema)), outputSchemaHash: digest(JSON.stringify(resultSchema)), checkpointSchemaVersion: 1, assignmentRevision: pod.revision, effects: 'readOnly' }, code)
      store.db.prepare('INSERT OR REPLACE INTO validations VALUES(?,?,?,?,?)').run(pod.id, hash, pod.revision, epoch, evidence)
      store.db.prepare('UPDATE script_drafts SET script_hash=?,validation=? WHERE id=? AND revision=?').run(hash, evidence, draftId, revision)
    })
    return { hash, evidence }
  }
  finally { fixture.close() }
}
