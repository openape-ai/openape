// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest'
import { parseWorkflowCommand, parseWorkflowView } from '../../src/contracts/workflows'
import { graphDetail } from '../../src/worker/workflows/detail'
import { closeGraphs, graphFixture } from './graph-fixture'

vi.mock('../../src/worker/runs/runner', () => ({ executeScript: vi.fn() }))
afterEach(closeGraphs)

it('derives the picture of a graph after one run: edges, kinds, counts, waiting items and the trace of one item', async () => {
  const f = graphFixture([{ key: 'batch', title: 'Newsletter batch', kind: 'approve', takes: 'mail.newsletter', gives: 'mail.approved', excluded: null }])
  const source = f.pod('Source', { takes: [], gives: ['mail.open'], summary: 'Reads mail' }, async (_items, emit) => { for (const key of ['mail-1', 'mail-2']) await emit('mail.open', { key, data: { subject: `Subject ${key}`, sender: 'news@example.test' } }) })
  const triage = f.pod('Triage', { takes: ['mail.open'], gives: ['mail.newsletter'], summary: 'Sorts mail' }, async (items, emit) => { for (const item of items) await emit('mail.newsletter', { key: item.key, data: item.data, reason: 'Bulk sender', confidence: 0.93 }) })
  const archive = f.pod('Archive', { takes: ['mail.approved'], gives: [], summary: 'Archives mail' }, async () => {})
  f.save([source, triage, archive], ['mail.open', 'mail.newsletter', 'mail.approved'])
  await f.run()
  // Assigned after the run: the fixture folder does not exist, and a run would refuse it.
  f.store.db.prepare('INSERT INTO resources VALUES(?,?,1,\'directory\',\'ready\',?,?)').run('00000000-0000-4000-8000-000000000099', archive, 'Accounting', JSON.stringify({ path: '/Users/fixture/Accounting', access: 'readWrite' }))
  const view = f.engine.view()
  const detail = graphDetail(f.store, view.workflows[0], 'mail-1')!
  expect(parseWorkflowView({ ...view, graph: detail }).graph).toEqual(detail)
  expect(detail.edges).toEqual([{ from: source, to: triage, channel: 'mail.open' }, { from: triage, to: 'gate:batch', channel: 'mail.newsletter' }, { from: 'gate:batch', to: archive, channel: 'mail.approved' }])
  expect(detail.nodeKinds).toEqual({ 'gate:batch': 'gate', [source]: 'code', [triage]: 'code', [archive]: 'effect' })
  expect(detail.rights[archive]).toEqual([{ label: 'Folder, read and write', target: '/Users/fixture/Accounting' }])
  expect(detail.counts.sort((a, b) => a.channel.localeCompare(b.channel))).toEqual([{ from: triage, to: 'gate:batch', channel: 'mail.newsletter', count: 2 }, { from: source, to: triage, channel: 'mail.open', count: 2 }])
  expect(detail.waiting).toEqual({ 'gate:batch': 2 })
  expect(detail.lastRun).toMatchObject({ state: 'completed' })
  expect(detail.items.map(item => [item.key, item.title, item.outcome, item.node]).sort()).toEqual([['mail-1', 'Subject mail-1 · news@example.test', 'held', 'gate:batch'], ['mail-2', 'Subject mail-2 · news@example.test', 'held', 'gate:batch']])
  expect(detail.trace).toMatchObject({ key: 'mail-1', title: 'Subject mail-1 · news@example.test' })
  expect(detail.trace!.events.map(event => [event.node, event.outcome, event.reason, event.confidence])).toEqual([[source, 'emitted', null, null], [triage, 'consumed', null, null], [triage, 'emitted', 'Bulk sender', 0.93], ['gate:batch', 'held', null, null]])
  expect(view.contracts).toMatchObject({ [source]: { summary: 'Reads mail' } })
})

it('draws a sequence workflow from its dependencies and answers an unknown graph with nothing', () => {
  const f = graphFixture()
  const [a, b] = [f.pod('First', { takes: [], gives: [], summary: 'First' }, async () => {}), f.pod('Second', { takes: [], gives: [], summary: 'Second' }, async () => {})]
  f.engine.save({ type: 'save', id: f.id, revision: 0, name: 'Morning', nodes: [{ podId: a, after: [], handoff: false }, { podId: b, after: [a], handoff: false }], schedule: null, enabled: false })
  const detail = graphDetail(f.store, f.engine.view().workflows[0])!
  expect(detail).toMatchObject({ edges: [{ from: a, to: b, channel: '' }], diagnostics: [], lastRun: null, counts: [], items: [], trace: null })
  expect(graphDetail(f.store, undefined)).toBeNull()
  expect(parseWorkflowCommand({ type: 'graph', id: f.id, key: 'mail-1' })).toEqual({ type: 'graph', id: f.id, key: 'mail-1' })
  expect(() => parseWorkflowCommand({ type: 'graph', id: f.id, key: '' })).toThrow('Invalid workflow run identity')
})
