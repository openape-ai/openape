import { graphRowTables, projectGraph } from '../../contracts/graph-projection'
import type { GraphRows } from '../../contracts/graph-projection'
import type { GraphDetail } from '../../contracts/graphs'
import type { WorkflowDefinition } from '../../contracts/workflows'
import type { PodDatabase } from '../storage/database'

/** The stored rows of one graph and its member Pods, in the order they were written. */
export function graphRows(store: PodDatabase, definition: WorkflowDefinition): GraphRows {
  const pods = JSON.stringify(definition.nodes.map(node => node.podId))
  const where: Record<keyof GraphRows, [string, ...string[]]> = {
    pods: ['id IN (SELECT value FROM json_each(?))', pods],
    scripts: ['pod_id IN (SELECT value FROM json_each(?))', pods],
    resources: ['pod_id IN (SELECT value FROM json_each(?))', pods],
    memberships: ['pod_id IN (SELECT value FROM json_each(?))', pods],
    members: ['pod_id IN (SELECT value FROM json_each(?))', pods],
    workflows: ['1=1'],
    variables: ['pod_id IN (SELECT value FROM json_each(?))', pods],
    runs: ['workflow_id=?', definition.id],
    items: ['workflow_id=?', definition.id],
    deliveries: ['item_id IN (SELECT id FROM graph_items WHERE workflow_id=?)', definition.id],
    events: ['workflow_id=?', definition.id],
  }
  return Object.fromEntries(Object.entries(graphRowTables).map(([name, table]) => {
    const [condition, ...values] = where[name as keyof GraphRows]
    return [name, store.db.prepare(`SELECT * FROM ${table} WHERE ${condition} ORDER BY rowid`).all(...values)]
  })) as unknown as GraphRows
}

export function graphDetail(store: PodDatabase, definition: WorkflowDefinition | undefined, key?: string): GraphDetail | null {
  return definition ? projectGraph(definition, graphRows(store, definition), key) : null
}
