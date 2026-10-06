import type { WorkflowDefinition, WorkflowOutput } from '../../contracts/workflows'
import { parseWorkflowOutput } from '../../contracts/workflows'
import type { PodDatabase } from '../storage/database'
import type { RunInput } from '../../contracts/runs'
import type { WorkflowCallRequest } from './calls'
import { loadWorkflowRevision } from './revisions'

export function workflowInput(store: PodDatabase, runId: string): RunInput['workflow'] {
  const attempt = store.db.prepare('SELECT a.*,w.definition FROM workflow_attempts a JOIN workflow_runs w ON w.id=a.workflow_run_id WHERE a.run_id=?').get(runId)
  if (!attempt) return undefined
  const definition = JSON.parse(attempt.definition as string) as WorkflowDefinition
  const node = definition.nodes.find(node => node.podId === attempt.pod_id)!
  const call = store.db.prepare('SELECT id,request,workflow_id,workflow_revision FROM workflow_call_requests WHERE workflow_run_id=?').get(attempt.workflow_run_id!)
  if (!node.handoff && !call) return undefined
  const outputs: Record<string, WorkflowOutput> = {}
  if (node.handoff) {
    for (const predecessor of node.after) {
      const output = store.db.prepare('SELECT state,output FROM workflow_nodes WHERE workflow_run_id=? AND pod_id=?').get(attempt.workflow_run_id as string, predecessor)
      if (output?.state !== 'completed' || !output.output) throw new Error('A required predecessor output is missing')
      outputs[predecessor] = parseWorkflowOutput(JSON.parse(output.output as string))
    }
  }
  // Package keys are only unambiguous when this Pod and all its predecessors came from the same import.
  const origin = (podId: string) => store.db.prepare('SELECT import_id,key FROM portable_import_pods WHERE pod_id=?').get(podId)
  const own = origin(node.podId); const origins = Object.keys(outputs).map(origin)
  const outputsByKey = own && origins.length && origins.every(item => item?.import_id === own.import_id) ? Object.fromEntries(Object.values(outputs).map((output, index) => [origins[index]!.key as string, output])) : undefined
  if (!call) return { runId: attempt.workflow_run_id as string, outputs, ...(outputsByKey ? { outputsByKey } : {}) }
  const request = JSON.parse(call.request as string) as WorkflowCallRequest
  const { published } = loadWorkflowRevision(store, call.workflow_id as string, Number(call.workflow_revision))
  const inputs = Object.fromEntries(published.ports.inputs.filter(port => port.podId === node.podId).map(port => [port.name, request.inputs[port.name]!]))
  return { runId: attempt.workflow_run_id as string, outputs, ...(outputsByKey ? { outputsByKey } : {}), call: { requestId: call.id as string, caseId: request.caseId, caseRevision: request.caseRevision }, inputs }
}

export function publishWorkflowOutput(store: PodDatabase, runId: string, value: unknown): void {
  const output = JSON.stringify(parseWorkflowOutput(value))
  const saved = store.db.prepare('UPDATE workflow_nodes SET output=? WHERE run_id=? AND state=\'running\' AND (output IS NULL OR output=?)').run(output, runId, output)
  if (saved.changes !== 1) throw new Error('Workflow output is already sealed or the run is unavailable')
}
