// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { deriveEdges } from '../../src/contracts/graphs'
import type { GraphContract, GraphGate } from '../../src/contracts/graphs'
import { diagnoseNetwork, networkApprovals, networkSubscriptionChannel, parseNetworkDefinition } from '../../src/contracts/networks'
import type { NetworkFeedback, NetworkJoin } from '../../src/contracts/networks'

const [intake, sorter, archive] = ['00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000003']
const gate: GraphGate = { key: 'batch', title: 'Newsletter batch', kind: 'approve', takes: 'mail.newsletter', gives: 'mail.approved', excluded: null }
const contracts: Record<string, GraphContract> = {
  [intake]: { takes: [], gives: ['mail.open'], summary: 'Reads new mail' },
  [sorter]: { takes: ['mail.open'], gives: ['mail.newsletter'], summary: 'Sorts mail' },
  [archive]: { takes: ['mail.approved'], gives: [], summary: 'Archives mail' },
}
function persistentNetwork() {
  const payload = { type: 'object', properties: { subject: { type: 'string' } }, required: ['subject'], additionalProperties: false }
  return {
    formatVersion: 6 as const, kind: 'network', semantics: 'persistent-network-v1', id: '00000000-0000-4000-8000-0000000000a0', revision: 1,
    groupId: '00000000-0000-4000-8000-0000000000b0', name: 'Persistent mail', routes: [] as GraphGate[], joins: [] as NetworkJoin[], feedback: [] as NetworkFeedback[],
    channels: ['mail.open', 'mail.sorted'].map(name => ({ name, title: name, schemaVersion: 1, schema: payload })),
    members: [intake, sorter, archive].map((podId, index) => ({
      podId, definitionId: podId, definitionVersion: 1, bindingRevision: 1, serialCase: true,
      contract: { takes: index === 0 ? [] : [index === 1 ? 'mail.open' : 'mail.sorted'], gives: index === 2 ? [] : [index === 0 ? 'mail.open' : 'mail.sorted'], summary: 'Processes metadata' },
      source: index === 0 ? { bindingId: '00000000-0000-4000-8000-0000000000c0', schedule: { kind: 'daily', time: '08:00', timezone: 'Europe/Vienna' } } : null,
    })),
  }
}

describe('persistent network definitions', () => {
  it('pins schemas, definitions, source bindings and independent source schedules', () => {
    const definition = parseNetworkDefinition(persistentNetwork())
    expect(definition).toEqual(persistentNetwork())
    expect(diagnoseNetwork(definition)).toEqual([])
    expect(definition.members[0]!.source!.schedule).toEqual({ kind: 'daily', time: '08:00', timezone: 'Europe/Vienna' })
  })

  it('reports undeclared channels and consumers without producers', () => {
    const definition = parseNetworkDefinition(persistentNetwork())
    definition.members[1]!.contract.takes = ['mail.missing']
    expect(diagnoseNetwork(definition)).toContainEqual({ code: 'channel-undeclared', podId: sorter, channel: 'mail.missing' })
    expect(diagnoseNetwork(definition)).toContainEqual({ code: 'channel-without-producer', podId: sorter, channel: 'mail.missing' })
  })

  it('rejects undeclared feedback and accepts one declared bounded transition', () => {
    const definition = parseNetworkDefinition(persistentNetwork())
    definition.members[2]!.contract.gives = ['mail.open']
    expect(diagnoseNetwork(definition).filter(item => item.code === 'cycle').map(item => item.podId)).toEqual([sorter, archive])
    const looped = { ...persistentNetwork(), feedback: [{ id: 'recheck', podId: archive, channel: 'mail.open', delayMs: 1000, maxHops: 3, maxCaseAgeMs: 86400000 }] }
    looped.members[2]!.contract = { ...looped.members[2]!.contract, gives: ['mail.open'] }
    const bounded = parseNetworkDefinition(looped)
    expect(bounded.feedback).toEqual(looped.feedback)
    expect(diagnoseNetwork(bounded)).toEqual([])
    // The declaration removes only its own edge: another immediate cycle stays invalid.
    bounded.members[1]!.contract.gives = ['mail.sorted', 'mail.open']
    expect(diagnoseNetwork(bounded).filter(item => item.code === 'cycle').map(item => item.podId)).toEqual([sorter])
    // Feedback bounds and targets are validated: sources, undeclared outputs, short delays and more than three hops are refused.
    for (const change of [{ podId: intake }, { channel: 'mail.sorted' }, { delayMs: 999 }, { maxHops: 4 }, { maxHops: 0 }, { maxCaseAgeMs: 86400001 }, { delayMs: 5000, maxCaseAgeMs: 4999 }]) {
      expect(() => parseNetworkDefinition({ ...looped, feedback: [{ ...looped.feedback[0]!, ...change }] })).toThrow(/feedback/)
    }
    // A join waits for every input of one case revision, so a joined channel cannot be fed back.
    const joinedSorter = looped.members.map((member, index) => index === 1 ? { ...member, contract: { ...member.contract, takes: ['mail.open', 'mail.sorted'] } } : member)
    expect(() => parseNetworkDefinition({ ...looped, members: joinedSorter, joins: [{ id: 'both', podId: sorter, channels: ['mail.open', 'mail.sorted'], deadlineMs: 60000, reviewDestination: 'owner' }] })).toThrow('explicitly joined channel')
    const extra = { name: 'mail.extra', title: 'mail.extra', schemaVersion: 1, schema: looped.channels[0]!.schema }
    const orphan = parseNetworkDefinition({ ...looped, channels: [...looped.channels, extra], feedback: [{ ...looped.feedback[0]!, channel: 'mail.extra' }], members: looped.members.map((member, index) => index === 2 ? { ...member, contract: { ...member.contract, gives: ['mail.extra'] } } : member) })
    expect(diagnoseNetwork(orphan)).toContainEqual({ code: 'feedback-bounds', podId: archive, channel: 'mail.extra' })
  })

  it('rejects unversioned schemas, unknown authority fields and duplicated instances', () => {
    const invalidVersion = persistentNetwork(); invalidVersion.channels[0]!.schemaVersion = 0
    expect(() => parseNetworkDefinition(invalidVersion)).toThrow('revision')
    expect(() => parseNetworkDefinition({ ...persistentNetwork(), permissions: ['mail.send'] })).toThrow('fields')
    const duplicate = persistentNetwork(); duplicate.members.push(duplicate.members[0]!)
    expect(() => parseNetworkDefinition(duplicate)).toThrow('unique')
  })

  it('accepts only the current format, where approvals exist once as routes', () => {
    const { feedback: _feedback, ...missing } = persistentNetwork()
    expect(() => parseNetworkDefinition(missing)).toThrow('fields')
    expect(() => parseNetworkDefinition({ ...persistentNetwork(), formatVersion: 5 })).toThrow('version')
    expect(() => parseNetworkDefinition({ ...persistentNetwork(), gates: [] })).toThrow('fields')
    const routed = persistentNetwork()
    routed.channels.push({ ...routed.channels[1]!, name: 'mail.approved', title: 'mail.approved' })
    routed.members[2]!.contract.takes = ['mail.approved']
    routed.routes = [{ key: 'archive', title: 'Archive sorted mail', kind: 'approve', takes: 'mail.sorted', gives: 'mail.approved', excluded: null }]
    const definition = parseNetworkDefinition(routed)
    expect(networkApprovals(definition)).toEqual([{ key: 'archive', title: 'Archive sorted mail', podId: archive, takes: 'mail.sorted', gives: 'mail.approved', excluded: null }])
    expect(networkSubscriptionChannel(definition, archive, 'mail.approved')).toBe('mail.sorted')
    expect(networkSubscriptionChannel(definition, sorter, 'mail.open')).toBe('mail.open')
    // The held consumer is exactly one Pod that takes the approved output and never the held input directly.
    routed.members[1]!.contract.takes = ['mail.open', 'mail.approved']
    expect(() => parseNetworkDefinition(routed)).toThrow('exactly one downstream consumer')
    routed.members[1]!.contract.takes = ['mail.open']; routed.members[2]!.contract.takes = ['mail.approved', 'mail.sorted']
    expect(() => parseNetworkDefinition(routed)).toThrow('exactly one downstream consumer')
  })

  it('keeps source and consumer activation policies distinct', () => {
    const input = persistentNetwork(); input.members[1]!.source = input.members[0]!.source
    expect(() => parseNetworkDefinition(input)).toThrow('source or a subscribed consumer')
  })
})

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
