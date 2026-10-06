import type { GraphMode } from '../../contracts/graphs'
import type { WorkflowDefinition, WorkflowView } from '../../contracts/workflows'

export type ArrangementFilter = 'all' | 'channels' | 'sequence'
export const arrangementLabel = (mode: GraphMode): 'Bounded graph' | 'Workflow' => mode === 'channels' ? 'Bounded graph' : 'Workflow'

export function waitingDecisions(definition: WorkflowDefinition, gates: WorkflowView['gates']): { choices: number, approvals: number } {
  if (!gates) return { choices: 0, approvals: 0 }
  const choiceGates = new Set(definition.gates.filter(gate => gate.kind === 'choose').map(gate => gate.key))
  const choices = new Set(gates.held.filter(item => item.workflowId === definition.id && choiceGates.has(item.gate)).map(item => item.itemId))
  const approvals = new Set(gates.batches.filter(batch => batch.workflowId === definition.id && batch.state === 'pending').flatMap(batch => batch.items.filter(item => !item.excluded).map(item => item.itemId)))
  return { choices: choices.size, approvals: approvals.size }
}
