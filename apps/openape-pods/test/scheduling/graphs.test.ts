// @vitest-environment node
import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { deriveEdges, diagnoseGraph } from '../../src/contracts/graphs'
import type { GraphContract, GraphGate, GraphMemberFacts } from '../../src/contracts/graphs'
import { parseWorkflowCommand, parseWorkflowView, sequenceParts } from '../../src/contracts/workflows'
import type { WorkflowDefinition } from '../../src/contracts/workflows'
import { PodVariables } from '../../src/worker/resources/variables'
import { PodDatabase } from '../../src/worker/storage/database'
import { WorkflowEngine } from '../../src/worker/workflows/engine'

const [intake, sorter, archive] = ['00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000003']
const channel = (name: string) => ({ name, title: name, fields: ['subject'] })
const gate: GraphGate = { key: 'batch', title: 'Newsletter batch', kind: 'approve', takes: 'mail.newsletter', gives: 'mail.approved', excluded: null }
const contracts: Record<string, GraphContract> = {
  [intake]: { takes: [], gives: ['mail.open'], summary: 'Reads new mail' },
  [sorter]: { takes: ['mail.open'], gives: ['mail.newsletter'], summary: 'Sorts mail' },
  [archive]: { takes: ['mail.approved'], gives: [], summary: 'Archives mail' },
}
function graph(change: Partial<WorkflowDefinition> = {}): WorkflowDefinition {
  return { id: '00000000-0000-4000-8000-0000000000a0', revision: 1, name: 'Mail', nodes: [intake, sorter, archive].map(podId => ({ podId, after: [], handoff: false })), schedule: null, enabled: false, paused: true, nextAt: null, mode: 'channels', groupId: null, channels: ['mail.open', 'mail.newsletter', 'mail.approved'].map(channel), gates: [gate], values: [{ name: 'whitelist', value: 'a@example.test', revision: 1 }], ...change }
}
const facts: Record<string, GraphMemberFacts> = { [archive]: { archive: true } }
const codes = (definition: WorkflowDefinition, known = contracts as Record<string, GraphContract | null>, memberFacts = facts) => diagnoseGraph(definition, known, memberFacts).map(({ code, node, channel }) => ({ code, node, channel }))

describe('derived edges', () => {
  it('connects every giver of a channel to every taker, including gates', () => {
    const members = Object.entries(contracts).map(([podId, contract]) => ({ podId, contract }))
    expect(deriveEdges(members, [gate])).toEqual([
      { from: intake, to: sorter, channel: 'mail.open' },
      { from: sorter, to: 'gate:batch', channel: 'mail.newsletter' },
      { from: 'gate:batch', to: archive, channel: 'mail.approved' },
    ])
  })
  it('lets a choose gate give every option channel', () => {
    const choose: GraphGate = { key: 'review', title: 'Review', kind: 'choose', takes: 'mail.open', options: [{ key: 'keep', title: 'Keep', channel: 'mail.keep' }, { key: 'drop', title: 'Drop', channel: 'mail.newsletter' }] }
    expect(deriveEdges([{ podId: sorter, contract: { takes: ['mail.keep', 'mail.newsletter'], gives: [], summary: 'Sink' } }], [choose]).map(edge => edge.channel)).toEqual(['mail.keep', 'mail.newsletter'])
  })
})

describe('graph diagnostics', () => {
  it('accepts a complete graph and ignores sequence workflows', () => {
    expect(codes(graph())).toEqual([])
    expect(codes(graph({ ...sequenceParts }), {})).toEqual([])
  })
  it('rejects a taken channel without a producer', () => {
    expect(codes(graph(), { ...contracts, [intake]: { ...contracts[intake]!, gives: [] } })).toEqual([{ code: 'channel-without-producer', node: sorter, channel: 'mail.open' }])
  })
  it('rejects a given channel without a consumer', () => {
    expect(codes(graph({ channels: [...graph().channels, channel('mail.done')] }), { ...contracts, [archive]: { ...contracts[archive]!, gives: ['mail.done'] } })).toEqual([{ code: 'channel-without-consumer', node: archive, channel: 'mail.done' }])
  })
  it('rejects a channel missing from the channel list, for Pods and gates', () => {
    expect(codes(graph({ channels: graph().channels.slice(0, 2) }))).toEqual([{ code: 'channel-undeclared', node: archive, channel: 'mail.approved' }, { code: 'channel-undeclared', node: 'gate:batch', channel: 'mail.approved' }])
  })
  it('rejects a script that emits outside its contract', () => {
    expect(codes(graph(), contracts, { ...facts, [sorter]: { emits: ['mail.newsletter', 'mail.approved'] } })).toEqual([{ code: 'emit-undeclared', node: sorter, channel: 'mail.approved' }])
  })
  it('rejects a cycle in the derived edges', () => {
    const looped = { ...contracts, [intake]: { ...contracts[intake]!, takes: ['mail.newsletter'] } }
    expect(codes(graph(), looped)).toEqual([{ code: 'cycle', node: null, channel: null }])
  })
  it('rejects an archive Pod that no gate precedes', () => {
    const bypass = { ...contracts, [archive]: { ...contracts[archive]!, takes: ['mail.newsletter'] } }
    expect(codes(graph({ gates: [], channels: graph().channels.slice(0, 2) }), bypass)).toEqual([{ code: 'archive-without-gate', node: archive, channel: null }])
  })
  it.each(['', ' ', 'x'.repeat(41)])('rejects the summary %j', (summary) => {
    expect(codes(graph(), { ...contracts, [sorter]: { ...contracts[sorter]!, summary } })).toEqual([{ code: 'summary-invalid', node: sorter, channel: null }])
  })
  it('rejects a member without a contract', () => {
    expect(codes(graph(), { ...contracts, [intake]: null }).map(item => item.code)).toEqual(['contract-missing', 'channel-without-producer'])
  })
  it('rejects a Pod that belongs to another graph or group', () => {
    expect(codes(graph(), contracts, { ...facts, [sorter]: { elsewhere: true } })).toEqual([{ code: 'member-elsewhere', node: sorter, channel: null }])
  })
  it('rejects a graph value that shares its name with a Pod variable', () => {
    expect(codes(graph(), contracts, { ...facts, [sorter]: { variables: ['whitelist'] } })).toEqual([{ code: 'value-name-conflict', node: sorter, channel: null }])
  })
})

describe('graph definition parsing', () => {
  const save = (change: Record<string, unknown>) => parseWorkflowCommand({ type: 'save', id: graph().id, revision: 0, name: 'Mail', nodes: graph().nodes, schedule: null, enabled: false, mode: 'channels', ...change })
  it('reads a command without graph fields as a sequence workflow', () => {
    expect(parseWorkflowCommand({ type: 'save', id: graph().id, revision: 0, name: 'Old', nodes: graph().nodes, schedule: null, enabled: false })).toMatchObject(sequenceParts)
  })
  it.each([
    ['an uppercase channel', { channels: [channel('Mail.open')] }, 'Invalid graph channel'],
    ['a channel with six segments', { channels: [channel('a.b.c.d.e.f')] }, 'Invalid graph channel'],
    ['a duplicate channel', { channels: [channel('mail.open'), channel('mail.open')] }, 'unique'],
    ['33 channels', { channels: Array.from({ length: 33 }, (_, index) => channel(`mail.c${index}`)) }, 'at most 32 channels'],
    ['9 gates', { gates: Array.from({ length: 9 }, (_, index) => ({ ...gate, key: `gate-${index}` })) }, 'at most 8 gates'],
    ['a gate that gives what it takes', { gates: [{ ...gate, gives: gate.takes }] }, 'unique'],
    ['a choose gate with one option', { gates: [{ key: 'review', title: 'Review', kind: 'choose', takes: 'mail.open', options: [{ key: 'keep', title: 'Keep', channel: 'mail.keep' }] }] }, 'Invalid graph gate'],
    ['an automatic gate kind', { gates: [{ ...gate, kind: 'auto' }] }, 'Invalid graph gate'],
    ['an oversized value', { values: [{ name: 'whitelist', value: 'x'.repeat(16385), revision: 0 }] }, 'Invalid graph value'],
    ['33 values', { values: Array.from({ length: 33 }, (_, index) => ({ name: `value-${index}`, value: '', revision: 0 })) }, 'at most 32 values'],
    ['dependencies in channel mode', { nodes: [{ podId: intake, after: [], handoff: false }, { podId: sorter, after: [intake], handoff: false }] }, 'Channel graphs cannot use'],
    ['handoff in channel mode', { nodes: [{ podId: intake, after: [], handoff: true }] }, 'Channel graphs cannot use'],
    ['channels in sequence mode', { mode: 'sequence', channels: [channel('mail.open')] }, 'need channel mode'],
    ['an unknown mode', { mode: 'parallel' }, 'Invalid graph mode'],
    ['a malformed group', { groupId: 'delta-mind' }, 'Invalid graph group'],
  ])('rejects %s', (_name, change, message) => {
    expect(() => save(change)).toThrow(message)
  })
})

describe('graph storage', () => {
  const stores: PodDatabase[] = []; const roots: string[] = []
  afterEach(() => { for (const store of stores.splice(0)) store.close(); for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })
  function fixture() {
    const root = mkdtempSync(join(tmpdir(), 'pods-graph-')); roots.push(root)
    const store = new PodDatabase(root); stores.push(store)
    const driver = { start: vi.fn(() => randomUUID()), cancelPod: vi.fn() }
    const engine = new WorkflowEngine(store, driver, { inspect: vi.fn(async () => {}) }, () => 1000)
    const pods = ['Intake', 'Sorter'].map(name => store.createPod({ name }).id)
    const groupId = randomUUID(); store.db.prepare('INSERT INTO pod_groups VALUES(?,?,0)').run(groupId, 'Delta Mind')
    const id = randomUUID()
    const command = (change: Record<string, unknown> = {}) => ({ type: 'save' as const, id, revision: 0, name: 'Mail', nodes: pods.map(podId => ({ podId, after: [], handoff: false })), schedule: null, enabled: false, mode: 'channels' as const, groupId, channels: graph().channels, gates: [gate], values: [{ name: 'whitelist', value: 'a@example.test', revision: 0 }], ...change })
    return { store, engine, driver, pods, groupId, id, command }
  }
  it('persists mode, group, channels, gates and values under one revision', () => {
    const f = fixture(); f.engine.save(f.command())
    const [saved] = parseWorkflowView(f.engine.view()).workflows
    expect(saved).toMatchObject({ revision: 1, mode: 'channels', groupId: f.groupId, channels: graph().channels, gates: [gate], values: [{ name: 'whitelist', value: 'a@example.test', revision: 1 }] })
  })
  it('replaces the parts on the next revision and counts value revisions per change', () => {
    const f = fixture(); f.engine.save(f.command())
    f.engine.save(f.command({ revision: 1, channels: graph().channels.slice(0, 1), gates: [], values: [{ name: 'whitelist', value: 'b@example.test', revision: 1 }, { name: 'folder', value: '/accounting', revision: 0 }] }))
    f.engine.save(f.command({ revision: 2, channels: graph().channels.slice(0, 1), gates: [], values: [{ name: 'whitelist', value: 'b@example.test', revision: 2 }] }))
    expect(f.engine.view().workflows[0]).toMatchObject({ revision: 3, channels: [channel('mail.open')], gates: [], values: [{ name: 'whitelist', value: 'b@example.test', revision: 2 }] })
  })
  it('keeps every stored part when a save is refused', () => {
    const f = fixture(); f.engine.save(f.command())
    const before = f.engine.view().workflows
    expect(() => f.engine.save(f.command({ revision: 0, channels: [] }))).toThrow('Workflow changed')
    expect(() => f.engine.save(f.command({ revision: 1, groupId: randomUUID(), channels: [] }))).toThrow('Graph group not found')
    expect(f.engine.view().workflows).toEqual(before)
  })
  it('refuses a graph value that shares its name with a member Pod variable', () => {
    const f = fixture(); new PodVariables(f.store).save(f.pods[1]!, 'whitelist', 'pod value', 0)
    expect(() => f.engine.save(f.command())).toThrow('share a name')
    expect(f.engine.view().workflows).toEqual([])
  })
  it('never enables or starts a channel graph before item flow exists', () => {
    const f = fixture()
    expect(() => f.engine.save(f.command({ enabled: true, schedule: { kind: 'interval', seconds: 3600 } }))).toThrow('cannot run')
    f.engine.save(f.command())
    expect(() => f.engine.start(f.id, 1)).toThrow('cannot run')
    f.engine.tick()
    expect(f.driver.start).not.toHaveBeenCalled()
    expect(f.store.db.prepare('SELECT count(*) AS count FROM workflow_runs').get()?.count).toBe(0)
  })
})
