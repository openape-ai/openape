import { parseWorkflowView, parseWorkflowNodes, sequenceParts } from '../../../openape-pods/src/contracts/workflows'
import type { WorkflowView } from '../../../openape-pods/src/contracts/workflows'

export function workspaceWorkflows(read: (key: string) => unknown, keys: string[]): WorkflowView | undefined {
  if (!keys.includes('table/workflows/0')) return undefined
  function rows(table: string): Record<string, unknown>[] {
    return keys.filter(key => key.startsWith(`table/${table}/`)).sort((a, b) => Number(a.split('/')[2]) - Number(b.split('/')[2])).flatMap(key => read(key) as Record<string, unknown>[])
  }
  function json(value: unknown): unknown {
    if (typeof value !== 'string') throw new Error('Invalid workflow archive')
    return JSON.parse(value)
  }
  function flag(value: unknown): boolean {
    if (value !== 0 && value !== 1) throw new Error('Invalid workflow flag')
    return value === 1
  }
  const workflows = rows('workflows').filter(row => !flag(row.archived)).map(row => ({
    id: row.id, revision: row.revision, name: row.name, nodes: json(row.nodes),
    schedule: row.schedule === null ? null : json(row.schedule), enabled: flag(row.enabled),
    paused: flag(row.paused), nextAt: row.next_at,
    ...sequenceParts, mode: row.mode ?? 'sequence', groupId: row.group_id ?? null,
  }))
  const nodes = rows('workflow_nodes')
  const runs = rows('workflow_runs').sort((a, b) => Number(a.finished_at !== null) - Number(b.finished_at !== null) || Number(b.started_at) - Number(a.started_at)).slice(0, 100).map((row) => {
    const definition = json(row.definition) as Record<string, unknown>
    const graph = parseWorkflowNodes(definition.nodes)
    return {
      id: row.id, workflowId: row.workflow_id, revision: row.revision, paused: flag(row.paused),
      state: row.state, reason: row.reason, startedAt: row.started_at, finishedAt: row.finished_at,
      nodes: nodes.filter(node => node.workflow_run_id === row.id).map((node) => {
        const dependency = graph.find(item => item.podId === node.pod_id)
        if (!dependency) throw new Error('Invalid workflow node binding')
        return { ...dependency, state: node.state, reason: node.reason, runId: node.run_id, scriptHash: node.script_hash }
      }),
    }
  })
  return parseWorkflowView({ workflows, runs })
}
