import { patchNetworkDraft, compositionChanged } from '../../src/renderer/utils/network-replacement'
import { parseNetworkCommand } from '../../src/contracts/networks'
import type { NetworkDraft } from '../../src/contracts/networks'
import NetworkReplacement from '../../src/renderer/NetworkReplacement.vue'
import type { ReplacementPreview } from '../../src/contracts/network-replacement'
import NetworkRetirement from '../../src/renderer/NetworkRetirement.vue'
import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { GateBatchView } from '../../src/contracts/gates'
import type { GraphDetail, GraphGate } from '../../src/contracts/graphs'
import type { WorkflowDefinition, WorkflowView } from '../../src/contracts/workflows'
import { sequenceParts, parseWorkflowCommand  } from '../../src/contracts/workflows'
import NetworkConversion from '../../src/renderer/NetworkConversion.vue'
import NetworkCreate from '../../src/renderer/NetworkCreate.vue'
import NetworkDetail from '../../src/renderer/NetworkDetail.vue'
import { operationalFixture, recoveryFixture, conversionFixture } from '../layout/network-fixture'
import GateReview from '../../src/renderer/GateReview.vue'
import GraphCreate from '../../src/renderer/GraphCreate.vue'
import GraphInspector from '../../src/renderer/GraphInspector.vue'
import GraphOverview from '../../src/renderer/GraphOverview.vue'
import GraphPanel from '../../src/renderer/GraphPanel.vue'
import DesktopWorkspace from '../../src/renderer/central/DesktopWorkspace.vue'
import { installWorkspace } from '../layout/workspace-fixture'
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
    expect(wrapper.findAll('section').map(section => section.text())).toEqual(['Receivesmail.approved', 'ProducesNothing', 'Allowed actionsMove approved mail: pods-mail', 'ApprovalRuns only after the approval "Newsletter batch"', 'Last runIn: 3 · out: 0'])
    await button(wrapper, 'Open pod: script, rights, values').trigger('click')
    expect(wrapper.emitted('openPod')).toEqual([[archive]])
  })
  it('hides the last run in the blueprint and names a source without rights', () => {
    const wrapper = mount(GraphInspector, { props: { node: { ...node, id: intake, name: 'Intake', kind: 'code', contract: contracts[intake]!, rights: [], approval: null } } })
    expect(wrapper.findAll('section').map(section => section.text())).toEqual(['ReceivesNothing, starts with the network', 'Producesmail.open', 'Allowed actionsNothing beyond its own folder', 'ApprovalNone'])
  })
  it('shows a gate without rights and opens its approval with the number of waiting items', async () => {
    const wrapper = mount(GraphInspector, { props: { node: { ...node, id: 'gate:batch', name: approve.title, kind: 'gate', contract: null, gate: approve, rights: [] }, batches: [batch] } })
    expect(wrapper.findAll('section').map(section => section.text())).toEqual(['Receivesmail.newsletter', 'Producesmail.approvedmail.kept', 'ApprovalOne approval for the whole batch'])
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
    expect(wrapper.find('.graph-overview-heading p').text()).toBe('Networks connect Pods. Workflows define ordered processes.')
    expect(wrapper.findAll('.graph-group').map(section => section.find('h2').text())).toEqual(['Delta Mind', 'Ungrouped'])
    expect(wrapper.findAll('.graph-card').map(card => card.text())).toEqual(['Bounded graph · Pods: 3 · hourlyEmail managementChoices waiting: 1Approvals waiting: 3', 'PodPR monitor'])
    await wrapper.findAll('.graph-card')[0]!.trigger('click'); await wrapper.findAll('.graph-card')[1]!.trigger('click')
    await button(wrapper, 'Create network').trigger('click'); await button(wrapper, '+ Create network in Delta Mind').trigger('click')
    expect(wrapper.emitted('select')).toEqual([[graphId]])
    expect(wrapper.emitted('openPod')).toEqual([[single]])
    expect(wrapper.emitted('create')).toEqual([[null], [group]])
  })
  it('names a sequence workflow, a manual graph and hides creation in a read-only view', () => {
    const sequence = { ...definition, id: id(5), name: 'Morgenbriefing', mode: 'sequence' as const, groupId: null, enabled: false, gates: [], channels: [] }
    const wrapper = mount(GraphOverview, { props: { view: { workflows: [sequence], runs: [] }, pods, organization, readOnly: true } })
    expect(wrapper.findAll('.graph-card')[0]!.text()).toBe('Workflow · Pods: 3 · Manual onlyMorgenbriefing')
    expect(wrapper.findAll('button').map(item => item.text())).not.toContain('Create network')
    expect(mount(GraphOverview, { props: { view: { workflows: [], runs: [] }, pods: [], organization: { revision: 1, groups: [] } } }).text()).toContain('No network, workflow or pod yet.')
  })
})

describe('create by hand', () => {
  it('creates a graph from the free Pods of the chosen group', async () => {
    const wrapper = mount(GraphCreate, { props: { view: { workflows: [], runs: [] }, pods, organization, groupId: group } })
    await button(wrapper, 'Bounded graph').trigger('click')
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
    expect(takes!.findAll('option').map(option => option.text())).toEqual(['Nothing, starts with the network', ...definition.channels.map(channel => channel.name)])
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

function bridge(reply: (command: { type: string, id?: string }) => WorkflowView) {
  const workflows = vi.fn(async (command: { type: string, id?: string }) => structuredClone(reply(command)))
  window.pods = { networks: vi.fn(async () => ({ networks: [] })), workflows, workspace: vi.fn(), scripts: vi.fn() } as unknown as typeof window.pods
  return workflows
}

describe('graph panel', () => {
  it('opens the overview without a selected graph and loads the detail of a selected one', async () => {
    const workflows = bridge(() => ({ ...view, graph: detail }))
    const overview = mount(GraphPanel, { props: { view, pods, organization } })
    expect(overview.find('.graph-overview').exists()).toBe(true)
    expect(workflows).not.toHaveBeenCalled()
    const wrapper = mount(GraphPanel, { props: { view, pods, organization, selectedId: graphId } }); await flushPromises()
    expect(workflows).toHaveBeenCalledWith({ type: 'graph', id: graphId })
    expect(wrapper.find('.graph-panel-heading').text()).toContain('Email management')
    expect(wrapper.find('.graph-panel-heading').text()).toContain('Choices waiting: 1 · Approvals waiting: 3')
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
  it('reads a published view without a worker and links the approval instead of deciding', async () => {
    const workflows = bridge(() => { throw new Error('A published view must not ask the worker') })
    const events = [{ node: triage, outcome: 'emitted', channel: 'mail.newsletter', reason: 'Bulk sender', confidence: 0.93, at: 1 }, { node: 'gate:batch', outcome: 'held', channel: 'mail.newsletter', reason: null, confidence: null, at: 2 }]
    const published: WorkflowView = { ...view, graphs: { [graphId]: { ...detail, traces: { 'mail-1': events } } } }
    const wrapper = mount(GraphPanel, { props: { view: published, pods, organization, selectedId: graphId, readOnly: true } }); await flushPromises()
    expect(wrapper.findAll('.graph-node')).toHaveLength(5)
    await button(wrapper, 'Last run').trigger('click')
    expect(wrapper.findAll('.graph-count').map(count => count.text())).toEqual(['42', '25'])
    await wrapper.find('.item-trace .inventory-row').trigger('click'); await flushPromises()
    expect(wrapper.findAll('.item-trace li').map(row => row.find('strong').text())).toEqual(['Triage', 'Newsletter batch'])
    await button(wrapper, 'Open approval').trigger('click')
    expect(wrapper.find('.gate-review a').attributes()).toMatchObject({ href: batch.url, target: '_blank', rel: 'noopener noreferrer' })
    expect(wrapper.find('.gate-review a').text()).toBe('Approve at the identity provider (3)')
    expect(wrapper.findAll('.gate-review input')).toHaveLength(0)
    expect(wrapper.findAll('.gate-review button').map(item => item.text())).toEqual(['Back to the graph'])
    expect(workflows).not.toHaveBeenCalled()
  })
  it('shows no approval link for an address that is not https', () => {
    const wrapper = mount(GateReview, { props: { gate: approve, batches: [{ ...batch, url: 'javascript:alert(1)' }], readOnly: true } })
    expect(wrapper.find('a').exists()).toBe(false)
  })
})

describe('sharing entry points', () => {
  it('are absent when sharing is switched off', async () => {
    window.pods = { networks: vi.fn(async () => ({ networks: [] })), workflows: vi.fn(async () => structuredClone({ ...view, graph: detail })) } as unknown as typeof window.pods
    const overview = mount(GraphOverview, { props: { view, pods, organization, sharing: false } })
    const panel = mount(GraphPanel, { props: { view, pods, organization, selectedId: graphId, sharing: false } }); await flushPromises()
    for (const wrapper of [overview, panel]) {
      expect(wrapper.text()).not.toContain('Share')
      expect(wrapper.text()).not.toContain('Import')
      expect(wrapper.findAll('button').filter(item => item.attributes('disabled') !== undefined).map(item => item.text())).toEqual([])
    }
  })
  it('lead to the flow once it is switched on, and never from a read-only view', async () => {
    window.pods = { networks: vi.fn(async () => ({ networks: [] })), workflows: vi.fn(async () => structuredClone({ ...view, graph: detail })) } as unknown as typeof window.pods
    const overview = mount(GraphOverview, { props: { view, pods, organization, sharing: true } })
    await button(overview, 'Import').trigger('click')
    expect(overview.emitted('import')).toHaveLength(1)
    const panel = mount(GraphPanel, { props: { view, pods, organization, selectedId: graphId, sharing: true } }); await flushPromises()
    await button(panel, 'Share').trigger('click')
    expect(panel.emitted('share')).toEqual([[{ kind: 'workflow', id: graphId }]])
    const readOnly = mount(GraphPanel, { props: { view: { ...view, graphs: { [graphId]: detail } }, pods, organization, selectedId: graphId, sharing: true, readOnly: true } }); await flushPromises()
    expect(readOnly.findAll('button').map(item => item.text())).not.toContain('Share')
    expect(mount(GraphOverview, { props: { view, pods, organization, sharing: true, readOnly: true } }).findAll('button').map(item => item.text())).not.toContain('Import')
  })
})

describe('connected desktop graphs', () => {
  let desktop: ReturnType<typeof mount> | undefined
  afterEach(() => { desktop?.unmount(); desktop = undefined })
  async function open() {
    const workflows = vi.fn(async (command: { type: string, key?: string }) => structuredClone({ ...view, ...command.type === 'graph' ? { graph: { ...detail, trace: command.key ? { key: command.key, title: 'Newsletter 1', events: [{ node: 'gate:batch', outcome: 'held', channel: 'mail.newsletter', reason: null, confidence: null, at: 1 }] } : null } } : {} }))
    let state = structuredClone({ pods, organization })
    const workspace = vi.fn(async (command: { type: string, name?: string }) => {
      if (command.type === 'organize') state = { ...state, organization: { revision: state.organization.revision + 1, groups: [...state.organization.groups, { id: id(6), name: command.name!, collapsed: false, podIds: [] }] } }
      return structuredClone(state)
    })
    installWorkspace({ workflows, workspace, central: async command => command.type === 'status' ? { enabled: true, state: 'online', runtimeId: id(5) } : command.type === 'inventory' ? [] : { requestError: { status: 400, message: 'No fixture change feed' } } })
    desktop = mount(DesktopWorkspace); await flushPromises()
    return { workflows, workspace }
  }
  async function click(text: string) { await button(desktop!, text).trigger('click'); await flushPromises() }
  it('shows groups, derived edges, run counts, item traces and native approval controls', async () => {
    const { workflows } = await open()
    expect(desktop!.get('.graph-group h2').text()).toBe('Delta Mind')
    expect(desktop!.text()).toContain('Desktop online')
    await desktop!.get('.graph-card').trigger('click'); await flushPromises()
    expect(desktop!.findAll('.graph-node')).toHaveLength(5)
    expect(desktop!.findAll('.graph-edges path')).toHaveLength(4)
    expect(desktop!.get('.graph-panel-heading').text()).toContain('Delta Mind')
    await click('Last run')
    expect(desktop!.findAll('.graph-count').map(item => item.text())).toEqual(['42', '25'])
    await desktop!.get('.item-trace .inventory-row').trigger('click'); await flushPromises()
    expect(desktop!.get('.item-trace li').text()).toContain('Newsletter batch')
    await click('Open approval')
    expect(desktop!.findAll('.gate-row input')).toHaveLength(3)
    await click('Approve at the identity provider (3)')
    expect(workflows).toHaveBeenLastCalledWith({ type: 'gateOpen', batchId })
    await desktop!.findAll('.gate-row input')[0]!.setValue(false)
    await click('Exclude (1) and request approval again')
    expect(workflows).toHaveBeenCalledWith({ type: 'gateExclude', batchId, itemIds: [id(1)] })
  })
  it('routes an item choice through the connected desktop owner command', async () => {
    const { workflows } = await open()
    await desktop!.get('.graph-card').trigger('click'); await flushPromises()
    await desktop!.findAll('.graph-node').find(node => node.text().startsWith('Review'))!.trigger('click')
    await click('Open approval')
    expect(desktop!.get('.gate-item strong').text()).toBe('Short question about your offer')
    await click('Useful')
    expect(workflows).toHaveBeenCalledWith({ type: 'gateChoose', id: graphId, gate: 'review', itemId: id(6), option: 'useful' })
  })
  it('updates the group overview after creating a group through the graph surface', async () => {
    const { workspace } = await open()
    await click('Create network')
    await click('Create a Pod or company')
    await click('Group')
    await desktop!.get('input').setValue('IURIO')
    await desktop!.get('form').trigger('submit'); await flushPromises()
    expect(workspace).toHaveBeenCalledWith({ type: 'organize', revision: 4, action: 'create', name: 'IURIO' })
    expect(desktop!.findAll('.graph-group h2').map(item => item.text())).toEqual(['Delta Mind', 'IURIO', 'Ungrouped'])
  })
})

describe('networks and workflows presentation', () => {
  it('keeps the chosen mode filter when returning from a detail and reuses the workflow editor', async () => {
    const sequence = { ...definition, id: id(5), name: 'Morning briefing', mode: 'sequence' as const, gates: [], channels: [] }
    const published = { ...view, workflows: [definition, sequence], graphs: { [graphId]: detail } }
    const workflows = bridge(() => published)
    const wrapper = mount(GraphPanel, { props: { view: published, pods, organization } })
    await button(wrapper, 'Networks').trigger('click')
    expect(wrapper.findAll('.graph-card').map(card => card.find('strong').text())).toEqual(['Email management'])
    await wrapper.get('.graph-card').trigger('click')
    await wrapper.setProps({ selectedId: graphId }); await flushPromises()
    await button(wrapper, 'Networks & workflows').trigger('click')
    await wrapper.setProps({ selectedId: '' }); await flushPromises()
    expect(button(wrapper, 'Networks').attributes('aria-pressed')).toBe('true')
    await button(wrapper, 'Workflows').trigger('click')
    expect(wrapper.findAll('.graph-card').map(card => card.find('strong').text())).toEqual(['Morning briefing'])
    await button(wrapper, 'Create workflow').trigger('click')
    expect(wrapper.find('form[aria-label="Edit workflow"]').exists()).toBe(true)
    await button(wrapper, 'Cancel').trigger('click')
    expect(button(wrapper, 'Workflows').attributes('aria-pressed')).toBe('true')
    expect(wrapper.find('.graph-create').exists()).toBe(false)
    await button(wrapper, 'Create workflow').trigger('click')
    await wrapper.get('form input[required]').setValue('New ordered workflow')
    await wrapper.get('form input[type="checkbox"]').setValue(true)
    await wrapper.get('form').trigger('submit'); await flushPromises()
    expect(workflows).toHaveBeenLastCalledWith(expect.objectContaining({ type: 'save', revision: 0, name: 'New ordered workflow', schedule: null, enabled: false, nodes: [{ podId: pods[0]!.id, after: [], handoff: false }] }))
    expect(wrapper.emitted('changed')).toEqual([[published]])
    expect(wrapper.emitted('select')!.at(-1)![0]).toBe(workflows.mock.calls.at(-1)![0].id)
  })
  it('counts choices and approvals separately without counting held approval items or duplicate batches twice', () => {
    const held = [...batch.items.map(item => ({ itemId: item.itemId, key: item.key, title: item.title, workflowId: graphId, gate: approve.key })), ...view.gates!.held, ...view.gates!.held]
    const batches = [batch, { ...batch, id: id(5) }, { ...batch, id: id(6), state: 'unknown' as const, items: [{ ...batch.items[0]!, itemId: single }] }]
    const wrapper = mount(GraphOverview, { props: { view: { ...view, gates: { batches, held } }, pods, organization } })
    expect(wrapper.findAll('.graph-waiting').map(item => item.text())).toEqual(['Choices waiting: 1', 'Approvals waiting: 3'])
  })
  it('offers an empty filter reset and no creation or mutations in the browser', async () => {
    const wrapper = mount(GraphOverview, { props: { view, pods, organization, filter: 'sequence', readOnly: true } })
    expect(wrapper.findAll('.graph-group')).toHaveLength(0)
    expect(wrapper.text()).toContain('No results for this filter.')
    expect(wrapper.text()).not.toContain('Create workflow')
    await button(wrapper, 'Show all').trigger('click')
    expect(wrapper.emitted('update:filter')).toEqual([['all']])
  })
  it('shows readable channel titles with exact names once and keeps unknown channels readable', () => {
    const node = { id: triage, name: 'Triage', kind: 'decision' as const, contract: { ...contracts[triage]!, gives: ['mail.newsletter', 'mail.unknown'] }, gate: null, rights: [], approval: null, counts: { received: 0, given: 0, waiting: 0 } }
    const wrapper = mount(GraphInspector, { props: { node, channels: [{ name: 'mail.open', title: 'New mail', fields: [] }, { name: 'mail.newsletter', title: 'mail.newsletter', fields: [] }] } })
    expect(wrapper.findAll('section')[0]!.text()).toBe('ReceivesNew mailmail.open')
    expect(wrapper.findAll('.graph-channel-name').map(item => item.text())).toEqual(['mail.open'])
    expect(wrapper.findAll('section')[1]!.text()).toBe('Producesmail.newslettermail.unknown')
  })
  it('distinguishes used and unused delivery edges without removing either from the last run', () => {
    const wrapper = mount(GraphView, { props: { definition, detail, pods, mode: 'run' } })
    expect(wrapper.findAll('.graph-edges path')).toHaveLength(4)
    expect(wrapper.findAll('.graph-edges path[data-active="true"]')).toHaveLength(2)
    expect(wrapper.findAll('.graph-edges path[data-active="false"]')).toHaveLength(2)
    expect(wrapper.text()).toContain('not confirmed external effects')
  })
})

describe('persistent network owner controls', () => {
  it('keeps explicit Pod pause review separate from selection and retains an action refusal across polling', async () => {
    vi.useFakeTimers()
    const f = operationalFixture()
    const networks = vi.fn(async (command: Parameters<typeof window.pods.networks>[0]) => {
      structuredClone(command)
      if (command.type === 'process') throw new Error('Process now preview expired or its instance configuration changed')
      if (command.type === 'preview') return { ...f.view, preview: { id: f.id(90), networkId: f.networkId, revision: 1, podIds: command.podIds, pausedPodIds: command.pausedPodIds, budget: command.budget, expiresAt: Date.now() + 300000, sources: command.podIds, consumers: [] } }
      return structuredClone(f.view)
    })
    installWorkspace({ networks })
    const wrapper = mount(NetworkDetail, { attachTo: document.body, props: { network: f.view.networks[0]!, view: f.view, pods: f.pods } })
    try {
      await flushPromises(); await button(wrapper, 'Process now').trigger('click')
      await wrapper.get('.network-process input[type=checkbox]').setValue(true)
      expect(button(wrapper, 'Preview processing').attributes('disabled')).toBeDefined()
      await wrapper.findAll('label').find(label => label.text() === 'Include paused Pod Mailbox source')!.get('input').setValue(true)
      await wrapper.get('.network-process').trigger('submit'); await flushPromises()
      expect(networks).toHaveBeenCalledWith(expect.objectContaining({ type: 'preview', podIds: [f.pods[0]!.id], pausedPodIds: [f.pods[0]!.id] }))
      expect(wrapper.get('.network-process').text()).toContain('Mailbox source · Source')
      expect(wrapper.get('.network-process').text()).toContain('Explicitly included paused Pod')
      await button(wrapper, 'Process up to 10').trigger('click'); await flushPromises()
      expect(wrapper.get('[role=alert]').text()).toContain('preview expired')
      await vi.advanceTimersByTimeAsync(5000); await flushPromises()
      expect(wrapper.get('[role=alert]').text()).toContain('preview expired')
      expect(networks.mock.calls.filter(([command]) => command.type === 'process')).toHaveLength(1)
    }
    finally { wrapper.unmount(); vi.useRealTimers() }
  })

  it.each(['detail', 'trace'])('allows pause after a failed %s read and retains the diagnostic', async (failedRead) => {
    const f = operationalFixture(); f.view.networks[0]!.state = 'active'
    const networks = vi.fn(async (command: Parameters<typeof window.pods.networks>[0]) => {
      if (command.type === failedRead) throw new Error('Synthetic read unavailable')
      return structuredClone(f.view)
    })
    installWorkspace({ networks })
    const wrapper = mount(NetworkDetail, { props: { network: f.view.networks[0]!, view: f.view, pods: f.pods } })
    try {
      await flushPromises()
      if (failedRead === 'trace') await button(wrapper, 'Recent recorded activity').trigger('click')
      expect(wrapper.get('[role=alert]').text()).toContain('Synthetic read unavailable')
      expect(button(wrapper, 'Pause network').attributes('disabled')).toBeUndefined()
      await button(wrapper, 'Pause network').trigger('click'); await flushPromises()
      expect(networks).toHaveBeenCalledWith({ type: 'pause', id: f.networkId, revision: 1 })
    }
    finally { wrapper.unmount() }
  })

  it('scopes recovery evidence to each effect and gate item and retains unrelated drafts', async () => {
    const f = recoveryFixture()
    const networks = vi.fn(async (command: Parameters<typeof window.pods.networks>[0]) => {
      structuredClone(command)
      if (command.type === 'inspect') f.view.details!.failures[0]!.inspectedAt = Date.now()
      return structuredClone(f.view)
    })
    installWorkspace({ networks })
    const wrapper = mount(NetworkDetail, { props: { network: f.view.networks[0]!, view: f.view, pods: f.pods } })
    const evidence = (name: string) => wrapper.findAll('label').find(label => label.text() === name)!.get('textarea')
    try {
      await flushPromises(); await button(wrapper, 'Failures requiring review: 1').trigger('click')
      await evidence(`Evidence for ${'d'.repeat(64)}`).setValue('Confirmed using the synthetic provider receipt')
      await evidence('Evidence to exclude Synthetic pending invoice').setValue('This invoice must stay out of approval')
      await evidence('Evidence for uncertain-approval').setValue('Retained unknown approval evidence')
      expect(button(wrapper, 'Confirm action happened').attributes('disabled')).toBeDefined()
      await button(wrapper, 'Inspect stopped process').trigger('click'); await flushPromises()
      expect((evidence(`Evidence for ${'d'.repeat(64)}`).element as HTMLTextAreaElement).value).toContain('provider receipt')
      await button(wrapper, 'Confirm action happened').trigger('click'); await flushPromises()
      expect(networks).toHaveBeenCalledWith(expect.objectContaining({ type: 'reconcileEffect', key: 'd'.repeat(64), attempt: 1, sequence: 2, evidence: 'Confirmed using the synthetic provider receipt' }))
      expect((evidence(`Evidence for ${'d'.repeat(64)}`).element as HTMLTextAreaElement).value).toBe('')
      expect((evidence('Evidence for uncertain-approval').element as HTMLTextAreaElement).value).toBe('Retained unknown approval evidence')
      await button(wrapper, 'Exclude Synthetic pending invoice with evidence').trigger('click'); await flushPromises()
      expect(networks).toHaveBeenCalledWith(expect.objectContaining({ type: 'gateExclude', taskId: f.id(61), deliveryIds: [f.id(63)], evidence: 'This invoice must stay out of approval' }))
      expect((evidence('Evidence for uncertain-approval').element as HTMLTextAreaElement).value).toBe('Retained unknown approval evidence')
    }
    finally { wrapper.unmount() }
  })

  it('requires an explicit shared value and sends a reviewed paused composition', async () => {
    const f = operationalFixture()
    const networks = vi.fn(async (command: Parameters<typeof window.pods.networks>[0]) => structuredClone(command).type === 'setup' ? { networks: [], setup: f.setup } : { ...f.view, createdId: f.networkId })
    installWorkspace({ networks, definitions: async () => f.definitions })
    const wrapper = mount(NetworkCreate, { props: { pods: f.pods, organization: f.organization, workflows: { workflows: [], runs: [] }, networks: { networks: [] }, groupId: f.groupId } })
    try {
      await flushPromises()
      await wrapper.findAll('button').find(item => item.text().startsWith('Persistent network'))!.trigger('click')
      await wrapper.get('input[maxlength="120"]').setValue('Owner reviewed network')
      for (const input of wrapper.findAll('input[type=checkbox]').reverse()) await input.setValue(true)
      await wrapper.get('form').trigger('submit'); await flushPromises()
      expect(wrapper.text()).toContain('Created paused. Activation is a separate action.')
      expect(wrapper.text()).toContain('Synthetic mailbox · read only')
      const shared = wrapper.findAll('fieldset').find(item => item.get('legend').text() === 'Shared values')!
      expect(shared.findAll('input[type=checkbox]')).toHaveLength(1)
      await shared.get('input[type=checkbox]').setValue(true)
      await shared.get('input[maxlength="1024"]').setValue('one-shared@example.invalid')
      await button(wrapper, 'Add field').trigger('click')
      await wrapper.get('input[pattern]').setValue('subject')
      await wrapper.get('form').trigger('submit'); await flushPromises()
      expect(networks).toHaveBeenCalledWith(expect.objectContaining({ type: 'create', draft: expect.objectContaining({ expectedSetup: f.setup.fingerprint, sharedValues: { mailbox: 'one-shared@example.invalid' } }) }))
      expect(wrapper.emitted('created')).toHaveLength(1)
    }
    finally { wrapper.unmount() }
  })

  it('shows the connected-runtime creation fence before a request can be made', async () => {
    const f = operationalFixture(); const networks = vi.fn()
    installWorkspace({ networks, definitions: async () => f.definitions })
    const wrapper = mount(NetworkCreate, { props: { pods: f.pods, organization: f.organization, workflows: { workflows: [], runs: [] }, networks: { networks: [], unavailableReason: 'Network creation requires bounded central publication support' } } })
    await flushPromises()
    expect(wrapper.get('[role=status]').text()).toContain('bounded central publication')
    expect(wrapper.findAll('button').find(item => item.text().startsWith('Persistent network'))!.attributes('disabled')).toBeDefined()
    expect(networks).not.toHaveBeenCalled(); wrapper.unmount()
  })
})

describe('reviewed legacy conversion', () => {
  function conversionPage(pending = 2) {
    const f = conversionFixture(); f.conversion.pending = pending
    const networks = vi.fn(async (value: Parameters<typeof window.pods.networks>[0]) => {
      const command = structuredClone(value)
      if (command.type === 'setup') return { networks: [], setup: f.setup }
      if (command.type === 'conversionPreview') return { networks: [], conversion: { ...f.conversion, issues: command.selection.checkpoints.length !== 3 ? ['Review each checkpoint'] : pending && command.selection.pending !== 'retainLegacy' ? ['Retain pending deliveries explicitly'] : [] } }
      return { ...f.view, createdId: f.networkId }
    })
    installWorkspace({ networks, definitions: async () => f.definitions })
    const wrapper = mount(NetworkConversion, { props: { legacy: f.legacy, pods: f.pods, organization: f.organization, workflows: { workflows: [f.legacy], runs: [] }, networks: { networks: [] } } })
    return { ...f, wrapper, networks }
  }

  it('cancels a read-only preview without sending a cutover or activation', async () => {
    const f = conversionPage()
    try {
      await flushPromises(); f.wrapper.getComponent(NetworkCreate).vm.$emit('conversionDraft', f.draft); await flushPromises()
      expect(f.wrapper.text()).toContain('owner-reviewed-synthetic-baseline')
      expect(button(f.wrapper, 'Validate reviewed conversion').attributes('disabled')).toBeDefined()
      await button(f.wrapper, 'Cancel conversion').trigger('click')
      expect(f.wrapper.emitted('cancel')).toHaveLength(1)
      expect(f.networks.mock.calls.map(([command]) => command.type)).toEqual(['conversionPreview'])
    }
    finally { f.wrapper.unmount() }
  })

  it('requires every exact checkpoint, source versioning and pending disposition before confirmation', async () => {
    const f = conversionPage()
    try {
      await flushPromises(); f.wrapper.getComponent(NetworkCreate).vm.$emit('conversionDraft', f.draft); await flushPromises()
      for (const input of f.wrapper.findAll('.conversion-member input[type=checkbox]')) await input.setValue(true)
      await button(f.wrapper, 'Validate reviewed conversion').trigger('click'); await flushPromises()
      expect(f.wrapper.text()).toContain('Retain pending deliveries explicitly')
      expect(button(f.wrapper, 'Convert to paused network')).toBeUndefined()
      await f.wrapper.findAll('label').find(label => label.text().startsWith('Keep pending items'))!.get('input').setValue(true)
      await button(f.wrapper, 'Validate reviewed conversion').trigger('click'); await flushPromises()
      const reviewed = f.networks.mock.calls.at(-1)![0]
      expect(reviewed).toMatchObject({ type: 'conversionPreview', selection: { pending: 'retainLegacy', checkpoints: f.pods.map((pod, index) => ({ podId: pod.id, revision: 3, hash: 'd'.repeat(64), scriptHash: 'a'.repeat(64), explicitSourceVersions: index < 2 })) } })
      expect(button(f.wrapper, 'Convert to paused network').attributes('disabled')).toBeDefined()
      await f.wrapper.findAll('label').find(label => label.text().startsWith('Disable the old graph'))!.get('input').setValue(true)
      await button(f.wrapper, 'Convert to paused network').trigger('click'); await flushPromises()
      expect(f.networks).toHaveBeenLastCalledWith({ type: 'convert', selection: 'selection' in reviewed ? reviewed.selection : null, expectedFingerprint: f.conversion.fingerprint })
      expect(f.wrapper.emitted('created')).toHaveLength(1)
      expect(f.networks.mock.calls.some(([command]) => command.type === 'activate')).toBe(false)
    }
    finally { f.wrapper.unmount() }
  })

  it('invalidates a confirmed review when the legacy revision changes', async () => {
    const f = conversionPage(0)
    try {
      await flushPromises(); f.wrapper.getComponent(NetworkCreate).vm.$emit('conversionDraft', f.draft); await flushPromises()
      for (const input of f.wrapper.findAll('.conversion-member input[type=checkbox]')) await input.setValue(true)
      await button(f.wrapper, 'Validate reviewed conversion').trigger('click'); await flushPromises()
      expect(button(f.wrapper, 'Convert to paused network')).toBeDefined()
      await f.wrapper.setProps({ legacy: { ...f.legacy, revision: 2 } })
      expect(button(f.wrapper, 'Convert to paused network')).toBeUndefined()
      expect(f.networks.mock.calls.every(([command]) => command.type === 'conversionPreview')).toBe(true)
    }
    finally { f.wrapper.unmount() }
  })

  it('requires explicit field types without importing legacy names or schedules', async () => {
    const f = conversionFixture(); const networks = vi.fn(async () => ({ networks: [], setup: f.setup }))
    installWorkspace({ networks, definitions: async () => f.definitions })
    const wrapper = mount(NetworkCreate, { props: { pods: f.pods, organization: f.organization, workflows: { workflows: [f.legacy], runs: [] }, networks: { networks: [] }, conversion: f.legacy } })
    try {
      await flushPromises(); await wrapper.get('form').trigger('submit'); await flushPromises()
      expect(wrapper.text()).toContain('Legacy field names: subject')
      expect(wrapper.findAll('input[pattern]')).toHaveLength(0)
      await button(wrapper, 'Add field').trigger('click')
      await wrapper.get('input[pattern]').setValue('subject')
      const type = wrapper.findAll('select').find(select => select.text().includes('Choose a type'))!
      expect((type.element as HTMLSelectElement).value).toBe('')
      await type.setValue('string')
      await wrapper.findAll('label').find(label => label.text().startsWith('I reviewed each channel schema'))!.get('input').setValue(true)
      await wrapper.get('form').trigger('submit'); await flushPromises()
      expect(wrapper.emitted('conversionDraft')![0]![0]).toMatchObject({ members: f.draft.members, channels: f.draft.channels.map(channel => ({ name: channel.name, schema: channel.schema })) })
      expect(networks.mock.calls).toHaveLength(1)
    }
    finally { wrapper.unmount() }
  })

  it('inspects the pinned script inline and keeps schemas when returning to editing', async () => {
    const f = conversionPage(0)
    const scripts = vi.fn(async () => ({ pod: f.pods[0]!, source: { hash: 'a'.repeat(64), code: 'export const reviewed = true' } } as never))
    window.pods.scripts = scripts
    try {
      await flushPromises(); await f.wrapper.getComponent(NetworkCreate).get('form').trigger('submit'); await flushPromises()
      await button(f.wrapper, 'Add field').trigger('click'); await f.wrapper.get('input[pattern]').setValue('subject')
      await f.wrapper.findAll('select').find(select => select.attributes('aria-label') === 'Type')!.setValue('string')
      await f.wrapper.findAll('label').find(label => label.text().startsWith('I reviewed each channel schema'))!.get('input').setValue(true)
      await f.wrapper.getComponent(NetworkCreate).get('form').trigger('submit'); await flushPromises()
      await f.wrapper.findAll('button').find(item => item.text() === 'Inspect active script')!.trigger('click'); await flushPromises()
      expect(f.wrapper.text()).toContain('export const reviewed = true')
      expect(scripts).toHaveBeenCalledWith({ type: 'list', podId: f.pods[0]!.id, selection: { kind: 'version', id: 'a'.repeat(64) } })
      expect(f.wrapper.emitted('openPod')).toBeUndefined()
      await button(f.wrapper, 'Edit schemas and values').trigger('click')
      expect((f.wrapper.get('input[pattern]').element as HTMLInputElement).value).toBe('subject')
      expect((f.wrapper.findAll('select').find(select => select.attributes('aria-label') === 'Type')!.element as HTMLSelectElement).value).toBe('string')
      expect(f.networks.mock.calls.some(([command]) => command.type === 'convert')).toBe(false)
    }
    finally { f.wrapper.unmount() }
  })

})

describe('reviewed network archival', () => {
  it('requires a current review and explicit confirmation, then shows terminal state', async () => {
    const f = operationalFixture(); const network = { ...f.view.networks[0]!, state: 'paused' as const }
    const networks = vi.fn(async (command: Parameters<typeof window.pods.networks>[0]) => ({ networks: [{ ...network, state: command.type === 'archiveNetwork' ? 'archived' as const : 'paused' as const }], ...(command.type === 'archivePreview' ? { archiveReview: { fingerprint: 'e'.repeat(64), issues: [], members: 3, retainedDeliveries: 2 } } : {}) }))
    installWorkspace({ networks })
    const wrapper = mount(NetworkRetirement, { props: { network } })
    try {
      await button(wrapper, 'Review archival').trigger('click'); await flushPromises()
      expect(button(wrapper, 'Archive network').attributes('disabled')).toBeDefined()
      await wrapper.get('input[type=checkbox]').setValue(true)
      await button(wrapper, 'Archive network').trigger('click'); await flushPromises()
      expect(networks).toHaveBeenLastCalledWith({ type: 'archiveNetwork', id: network.id, revision: network.revision, expectedFingerprint: 'e'.repeat(64) })
      expect(wrapper.emitted('changed')).toEqual([
        [expect.objectContaining({ networks: [expect.objectContaining({ state: 'paused' })] })],
        [expect.objectContaining({ networks: [expect.objectContaining({ state: 'archived' })] })],
      ])
      await wrapper.setProps({ network: { ...network, state: 'archived' } })
      expect(wrapper.text()).toContain('execution cannot resume')
      expect(button(wrapper, 'Review archival')).toBeUndefined()
      expect(button(wrapper, 'Inspect retained legacy items')).toBeDefined()
    }
    finally { wrapper.unmount() }
  })

  it('invalidates confirmation when revision or lifecycle changes and refuses unresolved work', async () => {
    const f = operationalFixture(); const network = { ...f.view.networks[0]!, state: 'paused' as const }
    const networks = vi.fn(async () => ({ networks: [network], archiveReview: { fingerprint: 'e'.repeat(64), issues: ['Resolve pending network deliveries before changing the composition'], members: 3, retainedDeliveries: 0 } }))
    installWorkspace({ networks })
    const wrapper = mount(NetworkRetirement, { props: { network } })
    try {
      await button(wrapper, 'Review archival').trigger('click'); await flushPromises()
      expect(wrapper.text()).toContain('Resolve pending network deliveries')
      expect(button(wrapper, 'Archive network')).toBeUndefined()
      await wrapper.setProps({ network: { ...network, revision: network.revision + 1 } })
      expect(wrapper.text()).not.toContain('Resolve pending network deliveries')
      await wrapper.setProps({ network: { ...network, state: 'active' } })
      expect(button(wrapper, 'Review archival').attributes('disabled')).toBeDefined()
      expect(networks).toHaveBeenCalledTimes(1)
    }
    finally { wrapper.unmount() }
  })

  it('hides execution and archival controls in archived or browser detail routes', async () => {
    const f = operationalFixture(); const network = { ...f.view.networks[0]!, state: 'archived' as const }
    const networks = vi.fn(async () => f.view)
    installWorkspace({ networks })
    const wrapper = mount(NetworkDetail, { props: { network, view: f.view, pods: f.pods } })
    try {
      await flushPromises()
      expect(button(wrapper, 'Activate network')).toBeUndefined()
      expect(button(wrapper, 'Process now')).toBeUndefined()
      expect(wrapper.findComponent(NetworkRetirement).exists()).toBe(true)
      await wrapper.setProps({ readOnly: true })
      expect(wrapper.findComponent(NetworkRetirement).exists()).toBe(false)
    }
    finally { wrapper.unmount() }
  })
})

describe('reviewed composition replacement', () => {
  function replacementPage() {
    const f = operationalFixture()
    f.definition.members[0]!.source!.schedule = { kind: 'daily', time: '09:30', timezone: 'Europe/Vienna' }
    f.definition.members[2]!.serialCase = true
    f.definition.channels[0]!.schema.properties.subject = { type: 'string', maxLength: 100 }
    f.definition.gates = [{ key: 'original-review', title: 'Retained title', kind: 'approve', podId: f.pods[2]!.id, channel: 'mail.input' }]
    const draft = { name: f.definition.name, groupId: f.groupId, channels: f.definition.channels, gates: f.definition.gates, joins: f.definition.joins, sharedValues: { mailbox: 'owner@example.invalid' }, members: f.definition.members.map(member => ({ podId: member.podId, serialCase: member.serialCase, source: member.source ? { schedule: member.source.schedule } : null })) }
    const replacement: ReplacementPreview = { fingerprint: 'e'.repeat(64), current: f.definition, candidate: f.definition, draft, issues: [], added: [], retired: [] }
    const networks = vi.fn(async (value: Parameters<typeof window.pods.networks>[0]) => {
      const command = structuredClone(value)
      if (command.type === 'setup') return { ...f.view, setup: f.setup }
      if (command.type === 'replacementSetup') return { ...f.view, replacement }
      if (command.type === 'replacementPreview') return { ...f.view, replacement: { ...replacement, draft: command.draft } }
      return { ...f.view, networks: f.view.networks.map(network => ({ ...network, revision: 2 })) }
    })
    installWorkspace({ networks, definitions: async () => structuredClone(f.definitions) })
    const wrapper = mount(NetworkReplacement, { props: { network: f.view.networks[0]!, pods: f.pods, organization: f.organization, workflows: { workflows: [], runs: [] }, networks: f.view } })
    return { ...f, draft, replacement, networks, wrapper }
  }

  it('preserves reviewed schedules, schema constraints, gate identity and serial cases when renaming', async () => {
    const f = replacementPage()
    try {
      await flushPromises()
      const editor = f.wrapper.getComponent(NetworkCreate)
      await editor.get('input[maxlength="120"]').setValue('Reviewed new name')
      await editor.get('form').trigger('submit'); await flushPromises()
      expect(editor.text()).toContain('Daily at 09:30 (Europe/Vienna)')
      expect(editor.text()).toContain('This advanced schema is retained unchanged.')
      await editor.get('form').trigger('submit'); await flushPromises()
      const preview = f.networks.mock.calls.map(([command]) => command).find(command => command.type === 'replacementPreview')!
      expect(preview).toMatchObject({ type: 'replacementPreview', draft: { ...f.draft, name: 'Reviewed new name' } })
      expect(button(f.wrapper, 'Save paused composition').attributes('disabled')).toBeDefined()
      const confirmation = f.wrapper.findAll('label').find(label => label.text() === 'Save these reviewed changes and keep the network paused.')!
      await confirmation.get('input').setValue(true)
      await button(f.wrapper, 'Save paused composition').trigger('click'); await flushPromises()
      expect(f.networks).toHaveBeenLastCalledWith({ type: 'replaceComposition', id: f.networkId, revision: 1, draft: { ...f.draft, name: 'Reviewed new name', expectedSetup: f.setup.fingerprint }, expectedFingerprint: f.replacement.fingerprint })
      expect(f.wrapper.emitted('changed')).toHaveLength(1)
      expect(f.networks.mock.calls.some(([command]) => command.type === 'activate')).toBe(false)
    }
    finally { f.wrapper.unmount() }
  })

  it('invalidates confirmed review when authority changes and requires a reload', async () => {
    const f = replacementPage()
    try {
      await flushPromises(); f.wrapper.getComponent(NetworkCreate).vm.$emit('replacementDraft', { ...f.draft, name: 'Changed' }); await flushPromises()
      await f.wrapper.findAll('label').find(label => label.text() === 'Save these reviewed changes and keep the network paused.')!.get('input').setValue(true)
      await f.wrapper.setProps({ pods: f.pods.map(pod => ({ ...pod, revision: pod.revision + 1 })) })
      expect(button(f.wrapper, 'Save paused composition').attributes('disabled')).toBeDefined()
      expect(f.wrapper.text()).toContain('Reload before reviewing again.')
      await button(f.wrapper, 'Save paused composition').trigger('click')
      expect(f.networks.mock.calls.some(([command]) => command.type === 'replaceComposition')).toBe(false)
      await button(f.wrapper, 'Reload composition').trigger('click'); await flushPromises()
      expect(f.wrapper.findComponent(NetworkCreate).exists()).toBe(true)
    }
    finally { f.wrapper.unmount() }
  })

  it('requires a separate initial-cursor review for every newly added source', async () => {
    const f = replacementPage()
    try {
      await flushPromises()
      const fresh = f.id(99)
      const draft = { ...f.draft, members: f.draft.members.map(member => member.podId === f.pods[0]!.id ? { ...member, podId: fresh } : member) }
      const candidate = { ...f.definition, members: f.definition.members.map(member => member.podId === f.pods[0]!.id ? { ...member, podId: fresh } : member) }
      f.networks.mockResolvedValueOnce({ ...f.view, replacement: { ...f.replacement, draft, candidate, added: [fresh], retired: [f.pods[0]!.id] } })
      f.wrapper.getComponent(NetworkCreate).vm.$emit('replacementDraft', draft); await flushPromises()
      expect(f.wrapper.text()).toContain('After activation, they may read historical inputs.')
      await f.wrapper.findAll('label').find(label => label.text() === 'Save these reviewed changes and keep the network paused.')!.get('input').setValue(true)
      expect(button(f.wrapper, 'Save paused composition').attributes('disabled')).toBeDefined()
      await f.wrapper.findAll('label').find(label => label.text() === 'I reviewed the initial cursor behavior of every new source.')!.get('input').setValue(true)
      expect(button(f.wrapper, 'Save paused composition').attributes('disabled')).toBeUndefined()
    }
    finally { f.wrapper.unmount() }
  })

})

it('creates valid fresh gate and join identifiers while preserving unchanged draft semantics', () => {
  const f = operationalFixture()
  const base: NetworkDraft = { name: f.definition.name, groupId: f.groupId, channels: f.definition.channels, members: f.definition.members.map(member => ({ podId: member.podId, source: member.source ? { schedule: member.source.schedule } : null, serialCase: member.serialCase })) }
  const unchanged = patchNetworkDraft(base, { ...base, members: [...base.members].reverse(), gates: [], joins: [], expectedSetup: 'a'.repeat(64) }, ['mail.input'], [])
  expect(compositionChanged(base, unchanged)).toBe(false)
  expect(unchanged.channels[0]!.schemaVersion).toBe(1)
  const draft = patchNetworkDraft(base, { ...base, gates: [{ key: 'review', title: 'Explicit review', kind: 'approve', podId: f.pods[2]!.id, channel: 'mail.input' }], joins: [{ id: 'join', podId: f.pods[2]!.id, channels: ['mail.input', 'other.input'], deadlineMs: 12345, reviewDestination: 'owner' }] }, [], [])
  expect(() => parseNetworkCommand({ type: 'create', draft })).not.toThrow()
  expect(draft.gates![0]!.key.length).toBeLessThanOrEqual(32)
  expect(draft.joins![0]!.id.length).toBeLessThanOrEqual(32)
  expect(patchNetworkDraft(draft, { ...draft, joins: draft.joins!.map(join => ({ ...join, deadlineMs: 99999 })) }, [], []).joins).toEqual(draft.joins)
})
