import { digest } from '../storage/database'
import type { PodDatabase } from '../storage/database'
import type { ResourceRegistry } from '../resources/registry'
import { assignedMail } from '../../main/mail/assigned'
import { inputSchema, resultSchema } from '../runs/examples'
import { WorkspaceDetails } from '../workspace/details'
import { mailRecipe } from './recipe'

export function installMailRecipe(store: PodDatabase, resources: ResourceRegistry, podId: string, dependencyLockHash: string): string {
  const pod = store.getPod(podId)
  assignedMail(resources.list(podId))
  const artifact = `export const assignmentRevision=${pod.revision};\n${mailRecipe}`
  const hash = digest(artifact)
  store.storeScript(podId, { schemaVersion: 1, contentHash: hash, entrypoint: 'run.mjs', dependencyLockHash, runtimeVersion: 'electron-40.9.3/codex-0.153.4/contract-1', capabilities: ['mail.read'], triggers: ['manual', 'schedule', 'event'], inputSchemaHash: digest(JSON.stringify(inputSchema)), outputSchemaHash: digest(JSON.stringify(resultSchema)), checkpointSchemaVersion: 1, assignmentRevision: pod.revision, effects: 'readOnly' }, artifact)
  store.db.prepare('INSERT OR REPLACE INTO validations VALUES(?,?,?,?,?)').run(podId, hash, pod.revision, resources.epoch(podId), JSON.stringify({ kind: 'bundled-mail-recipe', version: 1, dependencyLockHash }))
  new WorkspaceDetails(store, resources).execute({ type: 'activate', podId, hash, assignmentRevision: pod.revision, expectedActive: pod.activeScript })
  return hash
}
