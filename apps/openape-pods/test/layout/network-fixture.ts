import type { StoredPod } from '../../src/contracts/control'
import type { DefinitionsView } from '../../src/contracts/definitions'
import type { NetworkSetup } from '../../src/contracts/network-operations'
import type { NetworkDefinition, NetworkView } from '../../src/contracts/networks'

export function operationalFixture() {
  const id = (number: number) => `00000000-0000-4000-8000-${String(number).padStart(12, '0')}`
  const pods: StoredPod[] = ['Mailbox source', 'Independent timer', 'Case reviewer'].map((name, index) => ({ id: id(index + 1), name, revision: 1, lifecycle: 'paused', activeScript: 'a'.repeat(64) }))
  const groupId = id(20); const networkId = id(21)
  const contracts = pods.map((_, index) => ({ takes: index === 2 ? ['mail.input'] : [], gives: index === 2 ? [] : ['mail.input'], summary: index === 2 ? 'Reviews a case' : 'Independent source' }))
  const organization = { revision: 1, groups: [{ id: groupId, name: 'Synthetic operations company', collapsed: false, podIds: pods.map(pod => pod.id) }] }
  const definitions: DefinitionsView = {
    definitions: pods.map((pod, index) => ({ id: id(index + 10), name: pod.name, versions: [{ version: 1, state: 'published', contentHash: pod.activeScript!, lockHash: 'b'.repeat(64), contract: contracts[index]!, capabilities: index === 0 ? ['mail.read'] : [], packages: { dependencies: {} }, defaults: index < 2 ? { mailbox: 'synthetic@example.invalid' } : {} }] })),
    instances: pods.map((pod, index) => ({ podId: pod.id, definitionId: id(index + 10), version: 1, bindingRevision: 1, diverged: false, groupId })), provisioning: [],
  }
  const definition: NetworkDefinition = {
    formatVersion: 3, kind: 'network', semantics: 'persistent-network-v1', id: networkId, revision: 1, groupId, name: 'Synthetic operational network',
    members: pods.map((pod, index) => ({ podId: pod.id, definitionId: id(index + 10), definitionVersion: 1, bindingRevision: 1, contract: contracts[index]!, source: index < 2 ? { bindingId: id(index + 30), schedule: { kind: 'interval', seconds: (index + 1) * 60 } } : null, serialCase: false })),
    channels: [{ name: 'mail.input', title: 'Mail input', schemaVersion: 1, schema: { type: 'object', properties: { subject: { type: 'string' } }, required: ['subject'], additionalProperties: false } }], gates: [], joins: [],
  }
  const setup: NetworkSetup = { fingerprint: 'c'.repeat(64), groupId, members: pods.map((pod, index) => ({ podId: pod.id, name: pod.name, lifecycle: pod.lifecycle, capabilities: index === 0 ? ['mail.read'] : [], triggers: ['manual', 'schedule', 'event'], resourcesMore: false, resources: index === 0 ? [{ name: 'Synthetic mailbox · read only', kind: 'tool', state: 'ready' }] : [], values: index < 2 ? [{ name: 'mailbox', kind: 'public', origin: 'definition', value: 'synthetic@example.invalid' }] : [] })) }
  const view: NetworkView = {
    networks: [{ id: networkId, revision: 1, groupId, name: definition.name, state: 'paused', podIds: pods.map(pod => pod.id), counts: { pending: 2 }, health: { oldestPendingAt: Date.now() - 90000, nextRetryAt: null, lastDispatchAt: null, lastSchedulerProgressAt: Date.now(), lastSchedulerError: null, intakeError: null, lastFailure: null } }],
    details: { definition, members: setup.members, failures: [], collections: [], collectionsMore: false },
    trace: { events: [{ id: 1, caseId: id(50), runId: id(51), kind: 'event-accepted', body: '{"channel":"mail.input"}', truncated: false, at: Date.now() }], before: null },
  }
  return { id, pods, organization, definitions, setup, definition, view, groupId, networkId }
}

export function recoveryFixture() {
  const f = operationalFixture()
  f.view.details!.failures = [{ runId: f.id(60), generation: 2, podId: f.pods[2]!.id, kind: 'uncertain', reason: 'Synthetic external action needs reconciliation before retry.', inspectedAt: null, conflict: 'b'.repeat(64), effectsMore: false, effects: [{ key: 'd'.repeat(64), attempt: 1, sequence: 2, state: 'unknown' }] }]
  f.view.gates = [
    { id: f.id(61), networkId: f.networkId, gate: 'review-mail', podId: f.pods[2]!.id, generation: 1, state: 'pending', expiresAt: Date.now() + 600000, url: 'https://id.example.invalid/approval', error: null, items: [{ deliveryId: f.id(63), title: 'Synthetic pending invoice', outcome: 'held' }] },
    { id: f.id(62), networkId: f.networkId, gate: 'uncertain-approval', podId: f.pods[2]!.id, generation: 3, state: 'unknown', expiresAt: Date.now() + 600000, url: null, error: 'Synthetic approval outcome is unknown. Inspect before requesting fresh approval.', items: [{ deliveryId: f.id(64), title: 'Synthetic uncertain invoice', outcome: 'unknown' }] },
  ]
  return f
}
