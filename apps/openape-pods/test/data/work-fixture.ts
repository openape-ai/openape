import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DomainData } from '../../src/worker/data/domain'
import { OwnerQuestions } from '../../src/worker/data/questions'
import { WorkLedger } from '../../src/worker/data/work'
import type { WorkDeclaration } from '../../src/contracts/work'
import { ResourceRegistry } from '../../src/worker/resources/registry'
import { RunStore } from '../../src/worker/runs/store'
import { inputSchema, resultSchema } from '../../src/worker/runs/examples'
import { PodDatabase, digest } from '../../src/worker/storage/database'

const stores: PodDatabase[] = []; const roots: string[] = []
export function cleanup(): void { for (const store of stores.splice(0)) store.close(); for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) }

/** A profile with real storage, run leases and Pods whose active scripts declare work (issue 1465). */
export function workFixture(root = mkdtempSync(join(tmpdir(), 'pods-work-'))) {
  if (!roots.includes(root)) roots.push(root)
  const store = new PodDatabase(root); stores.push(store)
  store.db.prepare('UPDATE settings SET concurrency=8 WHERE id=1').run()
  const resources = new ResourceRegistry(store, () => {})
  const runs = new RunStore(store)
  const data = new DomainData(store)
  const work = new WorkLedger(store, data)
  const questions = new OwnerQuestions(store, data)
  /** Activates a script that declares `declarations`; scripts with equal declarations share a hash per Pod only. */
  const activate = (podId: string, declarations?: WorkDeclaration[]) => {
    const pod = store.getPod(podId)
    const artifact = `export async function run(context) { return { status: 'completed', summary: 'ok', completedInputIds: context.input.eventIds, gapIds: [] } }\n// ${JSON.stringify(declarations ?? null)} ${Math.random()}`
    const manifest = store.storeScript(podId, { schemaVersion: 1, contentHash: digest(artifact), entrypoint: 'run.mjs', dependencyLockHash: 'a'.repeat(64), runtimeVersion: 'node24', capabilities: [], triggers: ['manual', 'schedule', 'event'], inputSchemaHash: digest(JSON.stringify(inputSchema)), outputSchemaHash: digest(JSON.stringify(resultSchema)), checkpointSchemaVersion: 1, assignmentRevision: pod.bindingRevision, effects: 'readOnly', ...(declarations ? { work: declarations } : {}) }, artifact)
    store.db.prepare('INSERT OR REPLACE INTO validations VALUES(?,?,?,?,?)').run(podId, manifest.contentHash, pod.bindingRevision, resources.epoch(podId), '{}')
    store.db.prepare('UPDATE pods SET active_script=?,lifecycle=\'active\' WHERE id=?').run(manifest.contentHash, podId)
  }
  const pod = (name: string, declarations?: WorkDeclaration[]) => {
    const created = store.createPod({ name })
    activate(created.id, declarations)
    return created.id
  }
  /** Reserves a real run with its lease, as the dispatcher does before a script starts. */
  const run = (podId: string) => ({ podId, runId: runs.reserve(podId, store.getPod(podId).activeScript!, resources.epoch(podId)).run.id })
  const finish = (principal: { runId: string }, state: 'completed' | 'failed' = 'completed') => store.transaction(() => { work.settleRun(principal.runId); runs.finish(principal.runId, state, 'done', state === 'failed' ? 'failed' : null) })
  const close = () => { stores.splice(stores.indexOf(store), 1); store.close() }
  return { root, store, resources, runs, data, work, questions, pod, activate, run, finish, close }
}

export const classification = (overrides: Partial<WorkDeclaration> = {}): WorkDeclaration => ({ operation: 'acme/mail-classification', input: 'acme/mail/messages', output: 'acme/mail/classifications', fields: ['contentRevision'], filter: {}, ruleVersions: [1], ...overrides })
export const invoiceReview = (overrides: Partial<WorkDeclaration> = {}): WorkDeclaration => ({ operation: 'acme/invoice-review', input: 'acme/mail/classifications', output: 'acme/mail/invoice-reviews', fields: ['isInvoice', 'contentRevision'], filter: { isInvoice: true }, ruleVersions: [1], ...overrides })
