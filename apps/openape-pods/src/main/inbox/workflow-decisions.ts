import type { InboxDecisionOption } from '../../contracts/inbox'
import type { MapView } from '../../contracts/map-view'
import type { WorkflowCommand, WorkflowView } from '../../contracts/workflows'
import type { DecisionEntry, DecisionProjection } from './decisions'

// Graph workflow gates leave with the workflow model (issue 1455, M4): this module, its source and its worker call go together.
export function workflowDecisions(view: WorkflowView, map: MapView | null, workflows: (command: WorkflowCommand) => Promise<unknown>, projection: DecisionProjection): DecisionEntry[] {
  const automation = (id: string) => map?.collections.find(item => item.id === id)
  const held = (view.gates?.held ?? []).flatMap((item) => {
    const workflow = automation(item.workflowId)
    const gate = workflow?.gates.find(entry => entry.key === item.gate)
    if (!workflow || !gate?.options.length) return []
    const options = gate.options.map(option => ({ key: option.key, title: option.title, input: null }))
    return [projection.entry('workflow-held', [item.workflowId, item.gate, item.itemId], { podId: null, podName: null, title: item.title, body: `${gate.title} · ${workflow.name}`, authority: 'pods', options, link: null },
      async option => workflows({ type: 'gateChoose', id: item.workflowId, gate: item.gate, itemId: item.itemId, option }))]
  })
  const batches = (view.gates?.batches ?? []).filter(batch => projection.openBatch.includes(batch.state)).flatMap((batch) => {
    const link = batch.url ? { title: projection.t('Decide at the IdP'), url: batch.url } : null
    const options: InboxDecisionOption[] = batch.state === 'unknown' ? [{ key: 'discard', title: projection.t('Discard batch'), input: null }] : []
    if (!options.length && !link) return []
    const lines = [projection.t('{count} items', { count: batch.items.length }), ...batch.items.map(item => `- ${item.title}`)]
    return [projection.entry('workflow-batch', [batch.id], { podId: batch.podId, podName: projection.podName(batch.podId), title: `${projection.t('Approval batch')} · ${batch.gate}`, body: lines.join('\n'), authority: 'idp', options, link },
      async () => workflows({ type: 'gateDiscard', batchId: batch.id }))]
  })
  return [...held, ...batches]
}
