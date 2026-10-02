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
  if (!call) return { runId: attempt.workflow_run_id as string, outputs }
  const request = JSON.parse(call.request as string) as WorkflowCallRequest
  const { published } = loadWorkflowRevision(store, call.workflow_id as string, Number(call.workflow_revision))
  const inputs = Object.fromEntries(published.ports.inputs.filter(port => port.podId === node.podId).map(port => [port.name, request.inputs[port.name]!]))
  return { runId: attempt.workflow_run_id as string, outputs, call: { requestId: call.id as string, caseId: request.caseId, caseRevision: request.caseRevision }, inputs }
}

export function publishWorkflowOutput(store: PodDatabase, runId: string, value: unknown): void {
  const output = JSON.stringify(parseWorkflowOutput(value))
  const saved = store.db.prepare('UPDATE workflow_nodes SET output=? WHERE run_id=? AND state=\'running\' AND (output IS NULL OR output=?)').run(output, runId, output)
  if (saved.changes !== 1) throw new Error('Workflow output is already sealed or the run is unavailable')
}
