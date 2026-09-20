import type { WorkflowCommand, WorkflowDefinition } from './workflows'
import type { MasterAction } from './master'

export interface ChangeTarget {
  podId: string
  name: string
  base: string
  appliedBase?: string
  changedSinceApply?: boolean
  before: unknown
  actions: MasterAction[]
  review: { action: string, before: string, after: string, evidence: string | null }[]
  draftHashes: Record<string, string | null>
}
export interface ChangeSet {
  id: string
  conversationId: string
  contextRevision: number
  revision: number
  kind: 'changes' | 'run'
  state: 'pending' | 'applied' | 'discarded' | 'running' | 'failed'
  targets: ChangeTarget[]
  error: string | null
  execution?: { podId: string, runId: string | null, workflowId?: string, state: string, error: string | null }[]
  workflow?: { before: WorkflowDefinition, command: Extract<WorkflowCommand, { type: 'save' | 'start' }> }
  results: { podId: string, action: string, result: unknown }[]
}
