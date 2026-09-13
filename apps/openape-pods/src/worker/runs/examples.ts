import { digest } from '../storage/database'
import type { PodDatabase } from '../storage/database'
import type { ResourceRegistry } from '../resources/registry'

export const inputSchema = { type: 'object', additionalProperties: false, required: ['version', 'runId', 'podId', 'scriptHash', 'assignmentRevision', 'reason', 'eventIds', 'checkpointRevision', 'checkpoint', 'resourceEpoch', 'workspace', 'references', 'limits'], properties: { version: { const: 1 }, runId: { type: 'string' }, podId: { type: 'string' }, scriptHash: { type: 'string' }, assignmentRevision: { type: 'integer' }, reason: { enum: ['manual', 'schedule', 'event'] }, eventIds: { type: 'array', items: { type: 'string' } }, checkpointRevision: { type: 'integer' }, checkpoint: { type: 'object' }, resourceEpoch: { type: 'integer' }, workspace: { type: 'string' }, references: { type: 'array' }, limits: { type: 'object' } } }
export const resultSchema = { type: 'object', additionalProperties: false, required: ['status', 'summary', 'completedInputIds', 'gapIds'], properties: { status: { enum: ['completed', 'completedWithGaps', 'failed', 'cancelled', 'blocked'] }, summary: { type: 'string', maxLength: 10000 }, completedInputIds: { type: 'array', items: { type: 'string' } }, gapIds: { type: 'array', items: { type: 'string' } } } }
export function installExample(store: PodDatabase, resources: ResourceRegistry, podId: string, variant: 'deterministic' | 'agent', dependencyLockHash: string): void {
  const pod = store.getPod(podId)
  if (store.db.prepare('SELECT 1 FROM run_leases WHERE pod_id=?').get(podId)) throw new Error('Wait for the current run or recover it before changing versions')
  const artifact = `export const contractVersion=2; export const assignmentRevision=${pod.revision};
export async function run(context) {
  const count = Number(context.input.checkpoint.exampleRuns ?? 0) + 1;
  context.log('Starting local example '+count);
  ${variant === 'agent' ? 'const result = await context.agent.run({prompt:\'Summarize the purpose of a pod in one sentence. No tool call is required.\'}); context.log(result.response);' : ''}
  await context.progress.commit({expectedRevision:context.input.checkpointRevision,checkpoint:{...context.input.checkpoint,exampleRuns:count},sources:[],claims:[]});
  return {status:'completed',summary:'Local example completed ('+count+')',completedInputIds:context.input.eventIds,gapIds:[]};
}`
  const manifest = store.storeScript(podId, { schemaVersion: 1, contentHash: digest(artifact), entrypoint: 'run.mjs', dependencyLockHash, runtimeVersion: 'electron-40.9.3/codex-0.153.4/contract-1', capabilities: [], triggers: ['manual', 'schedule', 'event'], inputSchemaHash: digest(JSON.stringify(inputSchema)), outputSchemaHash: digest(JSON.stringify(resultSchema)), checkpointSchemaVersion: 1, assignmentRevision: pod.revision, effects: 'readOnly' }, artifact)
  store.transaction(() => {
    if (store.getPod(podId).revision !== pod.revision) throw new Error('Assignment changed during example installation')
    store.db.prepare('INSERT OR REPLACE INTO validations VALUES(?,?,?,?,?)').run(podId, manifest.contentHash, pod.revision, resources.epoch(podId), JSON.stringify({ kind: 'bundled-example', variant, contract: 1, dependencyLockHash }))
    const updated = store.db.prepare('UPDATE pods SET active_script=? WHERE id=? AND revision=? AND active_script IS ?').run(manifest.contentHash, podId, pod.revision, pod.activeScript)
    if (updated.changes !== 1) throw new Error('Active script changed during activation')
  })
}
