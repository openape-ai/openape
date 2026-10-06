import type { NetworkDraft } from '../../contracts/networks'
import { canonicalNetworkJson } from '../../contracts/network-json'

export function patchNetworkDraft(base: NetworkDraft, edited: NetworkDraft, changedSchemas: string[], changedSchedules: string[]): NetworkDraft {
  const order = new Map(base.members.map((member, index) => [member.podId, index]))
  const members = [...edited.members].sort((a, b) => (order.get(a.podId) ?? 64) - (order.get(b.podId) ?? 64)).map((member) => {
    const previous = base.members.find(item => item.podId === member.podId)
    if (!previous) return member
    return { ...previous, source: changedSchedules.includes(member.podId) ? member.source : previous.source }
  })
  const channels = edited.channels.map((channel) => {
    const previous = base.channels.find(item => item.name === channel.name)
    if (!previous) return channel
    if (!changedSchemas.includes(channel.name) || canonicalNetworkJson(channel.schema) === canonicalNetworkJson(previous.schema)) return previous
    return { ...channel, title: previous.title, schemaVersion: previous.schemaVersion + 1 }
  })
  const gates = edited.gates?.map(gate => base.gates?.find(item => item.podId === gate.podId && item.channel === gate.channel) ?? { ...gate, key: `review-${crypto.randomUUID().replaceAll('-', '').slice(0, 24)}` })
  const joins = edited.joins?.map(join => base.joins?.find(item => item.podId === join.podId) ?? { ...join, id: `join-${crypto.randomUUID().replaceAll('-', '').slice(0, 24)}` })
  const { gates: _gates, joins: _joins, ...fields } = edited
  return { ...base, ...fields, members, channels,
    ...(gates?.length || base.gates ? { gates: gates ?? [] } : {}),
    ...(joins?.length || base.joins ? { joins: joins ?? [] } : {}),
  }
}

export function compositionChanged(base: NetworkDraft, next: NetworkDraft): boolean {
  const { expectedSetup: _before, ...before } = base
  const { expectedSetup: _after, ...after } = next
  return canonicalNetworkJson(before) !== canonicalNetworkJson(after)
}

export function compositionDiff(missing: string) {
  const changes: { label: string, before: string, after: string }[] = []
  function add<T>(label: string, previous: T | undefined, next: T | undefined, display: (value: T) => string = value => JSON.stringify(value, null, 2)) {
    if (previous === undefined && next === undefined) return
    if (previous !== undefined && next !== undefined && canonicalNetworkJson(previous) === canonicalNetworkJson(next)) return
    changes.push({ label, before: previous === undefined ? missing : display(previous), after: next === undefined ? missing : display(next) })
  }
  return { changes, add }
}
