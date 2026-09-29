import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { GateBatchView } from '../../src/contracts/gates'
import type { GraphDetail, GraphGate } from '../../src/contracts/graphs'
import type { WorkflowDefinition, WorkflowView } from '../../src/contracts/workflows'
import { sequenceParts, parseWorkflowCommand  } from '../../src/contracts/workflows'
import GateReview from '../../src/renderer/GateReview.vue'
import GraphCreate from '../../src/renderer/GraphCreate.vue'
import GraphInspector from '../../src/renderer/GraphInspector.vue'
import GraphOverview from '../../src/renderer/GraphOverview.vue'
import GraphPanel from '../../src/renderer/GraphPanel.vue'
import GraphView from '../../src/renderer/GraphView.vue'
import ItemTrace from '../../src/renderer/ItemTrace.vue'
import { applyLanguage } from '../../src/renderer/i18n'
import { channelNames, contractScript, declaredChannels, newGraph, withMember } from '../../src/renderer/utils/graph-create'
import { parseGraphContract } from '../../src/contracts/graphs'

afterEach(() => applyLanguage('en'))
const id = (index: number) => `00000000-0000-4000-8000-00000000000${index}`
const [intake, triage, archive, single] = [id(1), id(2), id(3), id(4)]
const group = id(7); const graphId = id(8); const batchId = id(9)
const pods = [[intake, 'Intake'], [triage, 'Triage'], [archive, 'Archive'], [single, 'PR monitor']].map(([value, name]) => ({ id: value!, name: name!, revision: 1, lifecycle: 'paused' as const, activeScript: 'a'.repeat(64) }))
const approve: GraphGate = { key: 'batch', title: 'Newsletter batch', kind: 'approve', takes: 'mail.newsletter', gives: 'mail.approved', excluded: 'mail.kept' }
const choose: GraphGate = { key: 'review', title: 'Review', kind: 'choose', takes: 'mail.unsure', options: [{ key: 'useful', title: 'Useful', channel: 'mail.useful' }, { key: 'news', title: 'Newsletter', channel: 'mail.newsletter' }] }
const definition: WorkflowDefinition = { ...sequenceParts, id: graphId, revision: 3, name: 'Email management', nodes: [intake, triage, archive].map(podId => ({ podId, after: [], handoff: false })), schedule: { kind: 'interval', seconds: 3600 }, enabled: true, paused: false, nextAt: null, mode: 'channels', groupId: group, channels: ['mail.open', 'mail.newsletter', 'mail.approved', 'mail.kept', 'mail.unsure', 'mail.useful'].map(name => ({ name, title: name, fields: [] })), gates: [approve, choose], values: [] }
const contracts = { [intake]: { takes: [], gives: ['mail.open'], summary: 'Reads new mail' }, [triage]: { takes: ['mail.open'], gives: ['mail.newsletter', 'mail.unsure'], summary: 'Newsletter or useful' }, [archive]: { takes: ['mail.approved'], gives: [], summary: 'Archives approved mail' } }
const detail: GraphDetail = {
  workflowId: graphId, contracts,
  edges: [{ from: intake, to: triage, channel: 'mail.open' }, { from: triage, to: 'gate:batch', channel: 'mail.newsletter' }, { from: triage, to: 'gate:review', channel: 'mail.unsure' }, { from: 'gate:batch', to: archive, channel: 'mail.approved' }],
  nodeKinds: { [intake]: 'code', [triage]: 'decision', [archive]: 'effect', 'gate:batch': 'gate', 'gate:review': 'gate' },
  diagnostics: [], rights: { [intake]: [{ label: 'Mail, read only', target: '' }], [triage]: [{ label: 'Jev decisions', target: '' }], [archive]: [{ label: 'Move approved mail', target: 'pods-mail' }] },
  lastRun: { id: id(5), startedAt: 1_790_000_000_000, state: 'completed' },
  counts: [{ from: intake, to: triage, channel: 'mail.open', count: 42 }, { from: triage, to: 'gate:batch', channel: 'mail.newsletter', count: 25 }],
  waiting: { 'gate:batch': 25 }, items: [{ key: 'mail-1', title: 'Only today: 20 % off · news@shop.example', outcome: 'held', node: 'gate:batch' }], trace: null,
}
const batch: GateBatchView = { id: batchId, workflowId: graphId, gate: 'batch', podId: archive, state: 'pending', url: 'https://id.example.test/grant-approval?grant_id=one', expiresAt: 1_790_000_000_000, error: null, items: [1, 2, 3].map(index => ({ itemId: id(index), key: `mail-${index}`, title: `Newsletter ${index}`, excluded: false })) }
const organization = { revision: 4, groups: [{ id: group, name: 'Delta Mind', collapsed: false, podIds: [intake, triage, archive] }] }
const view: WorkflowView = { workflows: [definition], runs: [], gates: { batches: [batch], held: [{ itemId: id(6), workflowId: graphId, gate: 'review', key: 'mail-9', title: 'Short question about your offer' }] }, contracts }
const button = (wrapper: ReturnType<typeof mount>, text: string) => wrapper.findAll('button').find(item => item.text() === text)!

describe('graph view', () => {
  it('shows every node with the summary of its contract and the legend of the four kinds', () => {
    const wrapper = mount(GraphView, { props: { definition, detail, pods } })
    expect(wrapper.findAll('.graph-node').map(node => node.text())).toEqual(['IntakeReads new mail', 'TriageNewsletter or useful', 'Newsletter batchYou approve the batch', 'ReviewYou choose per item', 'ArchiveArchives approved mail'])
    expect(wrapper.findAll('.graph-node').map(node => node.attributes('data-kind'))).toEqual(['code', 'decision', 'gate', 'gate', 'effect'])
    expect(wrapper.find('.graph-legend').text()).toBe('Code, exact rulesDecision (Jev)Effect to the outsideApproval by you')
    expect(wrapper.findAll('.graph-edges path')).toHaveLength(4)
    expect(wrapper.find('.graph-count').exists()).toBe(false)
  })
  it('shows counts on the edges and per node in the last run', () => {
    const wrapper = mount(GraphView, { props: { definition, detail, pods, mode: 'run' } })
    expect(wrapper.findAll('.graph-count').map(count => count.text())).toEqual(['42', '25'])
    expect(wrapper.findAll('.graph-node').map(node => node.find('small').text())).toEqual(['In: 0 · out: 42', 'In: 42 · out: 25', 'Waiting: 25', 'Nothing to do', 'Nothing to do'])
  })
  it('emits the selected node and the chosen mode, and offers no last run before the first run', async () => {
    const wrapper = mount(GraphView, { props: { definition, detail, pods } })
    await wrapper.findAll('.graph-node')[1]!.trigger('click')
    await button(wrapper, 'Last run').trigger('click')
    expect(wrapper.emitted('select')).toEqual([[triage]])
    expect(wrapper.emitted('mode')).toEqual([['run']])
    const fresh = mount(GraphView, { props: { definition, detail: { ...detail, lastRun: null }, pods } })
    expect(button(fresh, 'Last run').attributes('disabled')).toBeDefined()
  })
  it('lists diagnostics in German and marks the node they belong to', async () => {
    applyLanguage('de')
    const wrapper = mount(GraphView, { props: { definition, pods, detail: { ...detail, diagnostics: [{ level: 'error', code: 'channel-without-consumer', message: 'A given channel has no node that takes it', node: triage, channel: 'mail.orphan' }] } } })
    expect(wrapper.find('.graph-diagnostics').text()).toBe('Ein gelieferter Kanal hat keinen Knoten, der ihn annimmt · mail.orphan')
    expect(wrapper.findAll('.graph-node').map(node => node.attributes('data-faulty'))).toEqual(['false', 'true', 'false', 'false', 'false'])
    await wrapper.find('.graph-diagnostics button').trigger('click')
    expect(wrapper.emitted('select')).toEqual([[triage]])
  })
  it('draws a sequence workflow from its dependencies and says when a graph is empty', () => {
    const sequence = { ...definition, mode: 'sequence' as const, gates: [], channels: [] }
    const wrapper = mount(GraphView, { props: { definition: sequence, pods, detail: { ...detail, contracts: {}, nodeKinds: {}, counts: [], waiting: {}, edges: [{ from: intake, to: triage, channel: '' }] } } })
    expect(wrapper.findAll('.graph-node').map(node => node.find('strong').text()).sort()).toEqual(['Archive', 'Intake', 'Triage'])
    expect(wrapper.findAll('.graph-edges path')).toHaveLength(1)
    expect(mount(GraphView, { props: { definition: { ...sequence, nodes: [] }, pods, detail: { ...detail, edges: [] } } }).text()).toContain('This graph has no nodes yet.')
  })
})

describe('inspector', () => {
  const node = { id: archive, name: 'Archive', kind: 'effect' as const, contract: contracts[archive]!, gate: null, rights: detail.rights[archive]!, approval: 'Newsletter batch', counts: { received: 3, given: 0, waiting: 0 } }
  it('shows contract, rights and the approval a Pod depends on', async () => {
    const wrapper = mount(GraphInspector, { props: { node, run: true } })
    expect(wrapper.findAll('section').map(section => section.text())).toEqual(['Takesmail.approved', 'GivesNothing', 'MayMove approved mail: pods-mail', 'ApprovalRuns only after the approval "Newsletter batch"', 'Last runIn: 3 · out: 0'])
    await button(wrapper, 'Open pod: script, rights, values').trigger('click')
    expect(wrapper.emitted('openPod')).toEqual([[archive]])
  })
  it('hides the last run in the blueprint and names a source without rights', () => {
    const wrapper = mount(GraphInspector, { props: { node: { ...node, id: intake, name: 'Intake', kind: 'code', contract: contracts[intake]!, rights: [], approval: null } } })
    expect(wrapper.findAll('section').map(section => section.text())).toEqual(['TakesNothing, starts with the graph', 'Givesmail.open', 'MayNothing beyond its own folder', 'ApprovalNone'])
  })
  it('shows a gate without rights and opens its approval with the number of waiting items', async () => {
    const wrapper = mount(GraphInspector, { props: { node: { ...node, id: 'gate:batch', name: approve.title, kind: 'gate', contract: null, gate: approve, rights: [] }, batches: [batch] } })
    expect(wrapper.findAll('section').map(section => section.text())).toEqual(['Takesmail.newsletter', 'Givesmail.approved, mail.kept', 'ApprovalOne approval for the whole batch'])
    await button(wrapper, 'Open approval (3)').trigger('click')
    expect(wrapper.emitted('openGate')).toEqual([['batch']])
  })
  it('says when the active script of a member exports no contract', () => {
    expect(mount(GraphInspector, { props: { node: { ...node, contract: null } } }).text()).toContain('The active script exports no contract.')
  })
})

describe('item trace', () => {
  const rows = [{ node: triage, name: 'Triage', kind: 'decision' as const, outcome: 'emitted', text: 'Bulk sender', detail: '93 %', open: false }, { node: 'gate:batch', name: 'Newsletter batch', kind: 'gate' as const, outcome: 'held', text: '', detail: 'mail.newsletter', open: true }]
  it('lists the steps of one item and opens the approval it waits for', async () => {
    const wrapper = mount(ItemTrace, { props: { title: 'Only today: 20 % off', rows } })
    expect(wrapper.findAll('li').map(row => row.text())).toEqual(['TriageDecision (Jev)Handed on: Bulk sender93 %', 'Newsletter batchApproval by youWaits for your decisionOpen approval'])
    await button(wrapper, 'Open approval').trigger('click')
    await button(wrapper, 'Back to the graph').trigger('click')
    expect(wrapper.emitted('openGate')).toEqual([['batch']])
    expect(wrapper.emitted('back')).toHaveLength(1)
  })
  it('lists the items of the last runs and emits the chosen key', async () => {
    const wrapper = mount(ItemTrace, { props: { items: detail.items, names: { 'gate:batch': 'Newsletter batch' } } })
    expect(wrapper.find('.inventory-row').text()).toContain('Waits for your decision · Newsletter batch')
    await wrapper.find('.inventory-row').trigger('click')
    expect(wrapper.emitted('open')).toEqual([['mail-1']])
    expect(mount(ItemTrace, { props: { items: [] } }).text()).toContain('No item has passed this graph yet.')
    expect(mount(ItemTrace, { props: { title: 'Mail', rows: [] } }).text()).toContain('No step is recorded for this item.')
  })
})

describe('gate review', () => {
  it('offers approval of the whole batch at the identity provider', async () => {
    const wrapper = mount(GateReview, { props: { gate: approve, batches: [batch] } })
    expect(wrapper.findAll('.gate-row').map(row => row.text())).toEqual(['Newsletter 1', 'Newsletter 2', 'Newsletter 3'])
    expect(wrapper.text()).toContain('Excluded items leave the batch and continue on mail.kept.')
    await button(wrapper, 'Approve at the identity provider (3)').trigger('click')
    expect(wrapper.emitted('approve')).toEqual([[batchId]])
  })
  it('replaces approval by exclusion as soon as an item is unchecked', async () => {
    const wrapper = mount(GateReview, { props: { gate: approve, batches: [batch] } })
    await wrapper.findAll('input')[1]!.setValue(false)
    expect(wrapper.findAll('button').map(item => item.text())).toEqual(['Back to the graph', 'Exclude (1) and request approval again'])
    await button(wrapper, 'Exclude (1) and request approval again').trigger('click')
    expect(wrapper.emitted('exclude')).toEqual([[batchId, [id(2)]]])
    expect(wrapper.emitted('approve')).toBeUndefined()
  })
  it('never excludes every item of a batch', async () => {
    const wrapper = mount(GateReview, { props: { gate: approve, batches: [batch] } })
    for (const input of wrapper.findAll('input')) await input.setValue(false)
    expect(button(wrapper, 'Exclude (3) and request approval again').attributes('disabled')).toBeUndefined()
    await button(wrapper, 'Exclude (3) and request approval again').trigger('click')
    expect(wrapper.emitted('exclude')).toEqual([[batchId, [id(1), id(2), id(3)]]])
  })
  it('shows an unknown outcome with its reason and offers only to discard the batch', async () => {
    const wrapper = mount(GateReview, { props: { gate: approve, batches: [{ ...batch, state: 'unknown', error: 'Approval grant differs from the reviewed batch or Pod identity' }] } })
    expect(wrapper.find('[role="alert"]').text()).toBe('Approval grant differs from the reviewed batch or Pod identity')
    expect(wrapper.findAll('input').every(input => input.attributes('disabled') !== undefined)).toBe(true)
    expect(wrapper.findAll('button').map(item => item.text())).toEqual(['Back to the graph', 'Discard batch; nothing is handed on'])
    await button(wrapper, 'Discard batch; nothing is handed on').trigger('click')
    expect(wrapper.emitted('discard')).toEqual([[batchId]])
  })
  it('shows finished batches apart and says when nothing waits', () => {
    const wrapper = mount(GateReview, { props: { gate: approve, batches: [{ ...batch, state: 'denied' }] } })
    expect(wrapper.text()).toContain('No batch waits for your approval.')
    expect(wrapper.find('details').text()).toContain('denied · Items: 3')
  })
  it('lets the owner pick one option per held item and disables every decision in a read-only view', async () => {
    const held = view.gates!.held
    const wrapper = mount(GateReview, { props: { gate: choose, held } })
    expect(wrapper.find('.gate-item').text()).toBe('Short question about your offerUsefulNewsletter')
    await button(wrapper, 'Newsletter').trigger('click')
    expect(wrapper.emitted('choose')).toEqual([[id(6), 'news']])
    expect(mount(GateReview, { props: { gate: choose, held: [] } }).text()).toContain('Nothing waits for your decision.')
    const readOnly = mount(GateReview, { props: { gate: choose, held, readOnly: true } })
    expect(button(readOnly, 'Useful').attributes('disabled')).toBeDefined()
  })
})

describe('overview', () => {
  it('groups graphs and single Pods and shows what waits for approval', async () => {
    const wrapper = mount(GraphOverview, { props: { view, pods, organization } })
    expect(wrapper.find('.graph-overview-heading p').text()).toBe('Groups: 1 · Graphs: 1 · Single pods: 1')
    expect(wrapper.findAll('.graph-group').map(section => section.find('h2').text())).toEqual(['Delta Mind', 'Ungrouped'])
    expect(wrapper.findAll('.graph-card').map(card => card.text())).toEqual(['Graph · Pods: 3 · hourlyEmail managementWaiting for approval: 4', 'PodPR monitor'])
    await wrapper.findAll('.graph-card')[0]!.trigger('click'); await wrapper.findAll('.graph-card')[1]!.trigger('click')
    await button(wrapper, 'Create new').trigger('click'); await button(wrapper, '+ Create in Delta Mind').trigger('click')
    expect(wrapper.emitted('select')).toEqual([[graphId]])
    expect(wrapper.emitted('openPod')).toEqual([[single]])
    expect(wrapper.emitted('create')).toEqual([[null], [group]])
  })
  it('names a sequence workflow, a manual graph and hides creation in a read-only view', () => {
    const sequence = { ...definition, id: id(5), name: 'Morgenbriefing', mode: 'sequence' as const, groupId: null, enabled: false, gates: [], channels: [] }
    const wrapper = mount(GraphOverview, { props: { view: { workflows: [sequence], runs: [] }, pods, organization, readOnly: true } })
    expect(wrapper.findAll('.graph-card')[0]!.text()).toBe('Sequence · Pods: 3 · Manual onlyMorgenbriefing')
    expect(wrapper.findAll('button').map(item => item.text())).not.toContain('Create new')
    expect(mount(GraphOverview, { props: { view: { workflows: [], runs: [] }, pods: [], organization: { revision: 1, groups: [] } } }).text()).toContain('No graph and no pod yet.')
  })
})

describe('create by hand', () => {
  it('creates a graph from the free Pods of the chosen group', async () => {
    const wrapper = mount(GraphCreate, { props: { view: { workflows: [], runs: [] }, pods, organization, groupId: group } })
    expect(button(wrapper, 'Create').attributes('disabled')).toBeDefined()
    await wrapper.find('input[type="text"]').setValue('Email management')
    expect(wrapper.findAll('.graph-create-check').map(item => item.text())).toEqual(['Intake', 'Triage', 'Archive'])
    await wrapper.findAll('.graph-create-check input')[0]!.setValue(true)
    await wrapper.findAll('select')[1]!.setValue('hourly')
    await wrapper.find('form').trigger('submit')
    expect(wrapper.emitted('create')).toEqual([[{ kind: 'graph', name: 'Email management', groupId: group, schedule: 'hourly', time: '07:00', podIds: [intake] }]])
  })
  it('creates a Pod with a contract and offers the channels of the chosen graph for takes', async () => {
    const wrapper = mount(GraphCreate, { props: { view, pods, organization, groupId: group } })
    await button(wrapper, 'Pod').trigger('click')
    const [name, summary, gives] = wrapper.findAll('input[type="text"]')
    await name!.setValue('Invoice filing'); await gives!.setValue('invoice.filed, invoice.failed')
    expect(button(wrapper, 'Create').attributes('title')).toBe('Enter a subtitle of at most 40 characters.')
    await summary!.setValue('PDF in accounting')
    const [, graph, takes] = wrapper.findAll('select')
    await graph!.setValue(graphId)
    expect(takes!.findAll('option').map(option => option.text())).toEqual(['Nothing, starts with the graph', ...definition.channels.map(channel => channel.name)])
    await takes!.setValue('mail.useful')
    await wrapper.find('form').trigger('submit')
    expect(wrapper.emitted('create')).toEqual([[{ kind: 'pod', name: 'Invoice filing', summary: 'PDF in accounting', groupId: group, graphId, takes: ['mail.useful'], gives: ['invoice.filed', 'invoice.failed'] }]])
  })
  it('creates a group, shows a failure and cancels', async () => {
    const wrapper = mount(GraphCreate, { props: { view, pods, organization, error: 'Workflow limit reached' } })
    expect(wrapper.find('[role="alert"]').text()).toBe('Workflow limit reached')
    await button(wrapper, 'Group').trigger('click')
    await wrapper.find('input[type="text"]').setValue('Private')
    await wrapper.find('form').trigger('submit'); await button(wrapper, 'Cancel').trigger('click')
    expect(wrapper.emitted('create')).toEqual([[{ kind: 'group', name: 'Private' }]])
    expect(wrapper.emitted('cancel')).toHaveLength(1)
  })
  it('builds a save command the worker accepts, starting disabled with every contract channel declared', () => {
    const command = newGraph(graphId, { kind: 'graph', name: ' Mail ', groupId: group, schedule: 'daily', time: '07:00', podIds: [intake, triage] }, contracts)
    expect(parseWorkflowCommand(command)).toMatchObject({ name: 'Mail', enabled: false, mode: 'channels', schedule: { kind: 'daily', time: '07:00' }, channels: [{ name: 'mail.open' }, { name: 'mail.newsletter' }, { name: 'mail.unsure' }] })
    expect(declaredChannels([{ name: 'mail.open', title: 'New mail', fields: ['subject'] }], [contracts[intake], null, undefined])).toEqual([{ name: 'mail.open', title: 'New mail', fields: ['subject'] }])
    expect(channelNames(' invoice.filed,invoice.failed  invoice.filed ')).toEqual(['invoice.filed', 'invoice.failed'])
  })
  it('adds a member to a graph and writes a script whose contract the runtime accepts', async () => {
    const contract = { takes: ['mail.useful'], gives: ['invoice.filed'], summary: 'PDF in accounting' }
    const command = withMember(definition, single, contract)
    expect(parseWorkflowCommand(command)).toMatchObject({ revision: 3, nodes: [{ podId: intake }, { podId: triage }, { podId: archive }, { podId: single }] })
    expect(command.channels!.map(channel => channel.name)).toContain('invoice.filed')
    const script = await import(`data:text/javascript,${encodeURIComponent(contractScript(contract))}`)
    expect(parseGraphContract(script.contract)).toEqual(contract)
    const emitted: unknown[] = []
    expect(await script.run({ items: [{ key: 'mail-1', channel: 'mail.useful', data: { id: 'one' } }], emit: async (...values: unknown[]) => { emitted.push(values) }, input: { eventIds: [] } })).toMatchObject({ status: 'completed', summary: '1 items' })
    expect(emitted).toEqual([['invoice.filed', { key: 'mail-1', data: { id: 'one' } }]])
  })
})

describe('graph panel', () => {
  function bridge(reply: (command: { type: string }) => WorkflowView) {
    const workflows = vi.fn(async (command: { type: string }) => structuredClone(reply(command)))
    window.pods = { workflows, workspace: vi.fn(), scripts: vi.fn() } as unknown as typeof window.pods
    return workflows
  }
  it('opens the overview without a selected graph and loads the detail of a selected one', async () => {
    const workflows = bridge(() => ({ ...view, graph: detail }))
    const overview = mount(GraphPanel, { props: { view, pods, organization } })
    expect(overview.find('.graph-overview').exists()).toBe(true)
    expect(workflows).not.toHaveBeenCalled()
    const wrapper = mount(GraphPanel, { props: { view, pods, organization, selectedId: graphId } }); await flushPromises()
    expect(workflows).toHaveBeenCalledWith({ type: 'graph', id: graphId })
    expect(wrapper.find('.graph-panel-heading').text()).toContain('Email management')
    expect(wrapper.find('.graph-panel-heading').text()).toContain('waiting for approval: 25')
    expect(wrapper.text()).toContain('Select a node to read its contract.')
    await wrapper.findAll('.graph-node')[1]!.trigger('click')
    expect(wrapper.find('.graph-inspector h2').text()).toBe('Triage')
  })
  it('opens the trace of one item and the approval that item waits for', async () => {
    const trace = { key: 'mail-1', title: 'Only today: 20 % off', events: [{ node: triage, outcome: 'emitted', channel: 'mail.newsletter', reason: 'Bulk sender', confidence: 0.93, at: 1 }, { node: 'gate:batch', outcome: 'held', channel: 'mail.newsletter', reason: null, confidence: null, at: 2 }] }
    const workflows = bridge(command => ({ ...view, graph: { ...detail, trace: 'key' in command ? trace : null } }))
    const wrapper = mount(GraphPanel, { props: { view, pods, organization, selectedId: graphId } }); await flushPromises()
    await wrapper.find('.item-trace .inventory-row').trigger('click'); await flushPromises()
    expect(workflows).toHaveBeenLastCalledWith({ type: 'graph', id: graphId, key: 'mail-1' })
    expect(wrapper.findAll('.item-trace li').map(row => row.find('strong').text())).toEqual(['Triage', 'Newsletter batch'])
    await button(wrapper, 'Open approval').trigger('click')
    expect(wrapper.find('.gate-review h2').text()).toBe('Newsletter batch')
    await button(wrapper, 'Approve at the identity provider (3)').trigger('click'); await flushPromises()
    expect(workflows).toHaveBeenLastCalledWith({ type: 'gateOpen', batchId })
  })
  it('sends an exclusion as an owner command and shows a refusal of the worker', async () => {
    const workflows = bridge((command) => { if (command.type === 'gateExclude') throw new Error('Only a batch that awaits approval can be changed'); return { ...view, graph: detail } })
    const wrapper = mount(GraphPanel, { props: { view, pods, organization, selectedId: graphId } }); await flushPromises()
    await wrapper.findAll('.graph-node')[2]!.trigger('click')
    await button(wrapper, 'Open approval (3)').trigger('click')
    await wrapper.findAll('.gate-row input')[0]!.setValue(false)
    await button(wrapper, 'Exclude (1) and request approval again').trigger('click'); await flushPromises()
    expect(workflows).toHaveBeenLastCalledWith({ type: 'gateExclude', batchId, itemIds: [id(1)] })
    expect(wrapper.find('[role="alert"]').text()).toBe('Only a batch that awaits approval can be changed')
  })
})
