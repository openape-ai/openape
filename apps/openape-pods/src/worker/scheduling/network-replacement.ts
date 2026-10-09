import type { Owner } from '@openape/pods-protocol'
import { randomUUID } from 'node:crypto'
import type { NetworkDefinition, NetworkDraft } from '../../contracts/networks'
import { networkSubscriptionChannel, draftControls, draftFormatVersion, parseNetworkDefinition } from '../../contracts/networks'
import type { ReplacementPreview } from '../../contracts/network-replacement'
import { parseGraphContract } from '../../contracts/graphs'
import { canonicalNetworkJson } from '../../contracts/network-json'
import { digest } from '../storage/database'
import type { PodDatabase } from '../storage/database'
import type { ResourceRegistry } from '../resources/registry'
import { networkSettlementIssues } from './network-retirement'
import { networkConfiguration, validateNetworkCompositionValues } from './network-config'
import { assertNetworkQuota } from './network-quota'
import { NetworkViews } from './network-views'

export function currentCompositionDraft(store: PodDatabase, definition: NetworkDefinition): NetworkDraft {
  return {
    name: definition.name, groupId: definition.groupId,
    channels: definition.channels, ...(definition.routes ? { routes: definition.routes } : {}), ...(definition.gates ? { gates: definition.gates } : {}), ...(definition.joins ? { joins: definition.joins } : {}), ...(definition.feedback ? { feedback: definition.feedback } : {}),
    members: definition.members.map(member => ({ podId: member.podId, serialCase: member.serialCase, source: member.source ? { schedule: member.source.schedule } : null })),
    sharedValues: Object.fromEntries(store.db.prepare('SELECT name,value FROM composition_config WHERE network_id=? ORDER BY name').all(definition.id).map(row => [row.name as string, JSON.parse(row.value as string)])),
  }
}

export class NetworkReplacement {
  constructor(private readonly store: PodDatabase, private readonly resources: ResourceRegistry, private readonly owner: Owner, private readonly validate: (definition: NetworkDefinition) => void) {}

  preview(current: NetworkDefinition, draft: NetworkDraft): ReplacementPreview {
    const row = this.store.db.prepare('SELECT * FROM networks WHERE id=?').get(current.id)!
    const issues = networkSettlementIssues(this.store, current.id)
    if (row.state !== 'paused') issues.unshift('Pause the network before replacing its composition')
    if (row.baseline_state !== 'ready') issues.push('Restored network requires a reviewed baseline')
    if (draft.groupId !== current.groupId) throw new Error('Composition replacement cannot change company ownership')
    let setupFingerprint: string | null = null
    const added = draft.members.filter(member => !current.members.some(old => old.podId === member.podId)).map(member => member.podId)
    const retired = current.members.filter(member => !draft.members.some(next => next.podId === member.podId)).map(member => member.podId)
    let candidate: NetworkDefinition | null = null
    try {
      setupFingerprint = new NetworkViews(this.store, this.resources).setup(this.owner, draft.groupId, draft.members.map(member => member.podId)).fingerprint
      if (draft.expectedSetup && draft.expectedSetup !== setupFingerprint) issues.push('Network setup changed; review current values and rights again')
      const historicalCount = Number(this.store.db.prepare('SELECT count(*) AS n FROM network_members WHERE network_id=?').get(current.id)!.n)
      if (historicalCount + added.length > 64) throw new Error('Network history supports at most 64 distinct member instances')
      const members = draft.members.map((selection) => {
        const previous = current.members.find(member => member.podId === selection.podId)
        if (!previous) this.assertFresh(selection.podId)
        if (previous && Boolean(previous.source) !== Boolean(selection.source)) throw new Error('Changing a source or consumer role requires a fresh instance')
        if (previous) return { ...previous, serialCase: selection.serialCase, source: selection.source ? { bindingId: previous.source!.bindingId, schedule: selection.source.schedule } : null }
        const binding = this.store.db.prepare(`SELECT b.*,v.contract FROM instance_definition_bindings b JOIN pod_definition_versions v ON v.definition_id=b.definition_id AND v.version=b.definition_version WHERE b.pod_id=?`).get(selection.podId)!
        return { podId: selection.podId, definitionId: binding.definition_id as string, definitionVersion: Number(binding.definition_version), bindingRevision: Number(binding.binding_revision), contract: parseGraphContract(JSON.parse(binding.contract as string)), serialCase: selection.serialCase, source: selection.source ? { bindingId: selection.podId, schedule: selection.source.schedule } : null }
      })
      const { sharedValues: _values, expectedSetup: _setup, ...composition } = draft
      const next = parseNetworkDefinition({ ...composition, formatVersion: draftFormatVersion(draft), kind: 'network', semantics: 'persistent-network-v1', id: current.id, revision: current.revision + 1, ...draftControls(draft), members })
      this.validate(next)
      validateNetworkCompositionValues(this.store, next, draft.sharedValues ?? {})
      for (const legacy of this.store.db.prepare('SELECT v.name FROM networks n JOIN workflow_values v ON v.workflow_id=n.ancestor_workflow_id WHERE n.id=?').all(current.id)) {
        if (typeof draft.sharedValues?.[legacy.name as string] !== 'string') throw new Error('Converted graph values require retained string configuration')
      }
      for (const channel of next.channels) {
        const latest = this.store.db.prepare(`SELECT json_extract(channel.value,'$.schemaVersion') AS version,
          json_extract(channel.value,'$.schema') AS schema FROM network_revisions revision,json_each(revision.contract,'$.channels') channel
          WHERE revision.network_id=? AND json_extract(channel.value,'$.name')=?
          ORDER BY json_extract(channel.value,'$.schemaVersion') DESC,revision.revision DESC LIMIT 1`).get(current.id, channel.name)
        if (latest && (channel.schemaVersion < Number(latest.version) || (channel.schemaVersion === Number(latest.version) && canonicalNetworkJson(channel.schema) !== canonicalNetworkJson(JSON.parse(latest.schema as string))))) throw new Error('Changed channel schemas require a new version; historical versions cannot be reused')
      }
      const bytes = Buffer.byteLength(canonicalNetworkJson(next)) + Buffer.byteLength(canonicalNetworkJson(draft.sharedValues ?? {})) + 16384 * members.length
      this.store.assertStorage(bytes); assertNetworkQuota(this.store, bytes)
      candidate = next
    }
    catch (error) { const message = error instanceof Error ? error.message : String(error); if (!issues.includes(message)) issues.push(message) }
    const checkpoints = this.store.db.prepare('SELECT * FROM network_checkpoints WHERE network_id=? ORDER BY pod_id').all(current.id)
    const authority = this.store.db.prepare('SELECT * FROM network_members WHERE network_id=? ORDER BY pod_id').all(current.id).map(member => ({ member, resourceEpoch: this.resources.epoch(member.pod_id as string), binding: this.store.db.prepare('SELECT * FROM instance_definition_bindings WHERE pod_id=?').get(member.pod_id!), configuration: this.store.db.prepare('SELECT * FROM instance_config WHERE pod_id=? ORDER BY name').all(member.pod_id!) }))
    const rights = this.rights(current.id)
    const lastTrace = this.store.db.prepare('SELECT max(id) AS id FROM network_trace_events WHERE network_id=?').get(current.id)!.id
    const fingerprint = digest(canonicalNetworkJson({ row, current, draft, candidate, issues, setupFingerprint, checkpoints, authority, rights, lastTrace }))
    return { fingerprint, current, candidate, draft, issues, added, retired }
  }

  private rights(networkId: string) {
    return Object.fromEntries(['data_permissions', 'artifact_permissions', 'workflow_call_permissions'].map(table => [table, this.store.db.prepare(`SELECT * FROM ${table} WHERE network_id=? ORDER BY rowid`).all(networkId)]))
  }

  private assertFresh(podId: string): void {
    const occupied = this.store.db.prepare(`SELECT 1 FROM network_members WHERE pod_id=? UNION ALL SELECT 1 FROM workflow_members WHERE pod_id=?
      UNION ALL SELECT 1 FROM schedules WHERE pod_id=? UNION ALL SELECT 1 FROM runs WHERE pod_id=? UNION ALL SELECT 1 FROM accepted_events WHERE pod_id=?
      UNION ALL SELECT 1 FROM run_leases WHERE pod_id=? UNION ALL SELECT 1 FROM program_leases WHERE pod_id=?
      UNION ALL SELECT 1 FROM effect_ledger WHERE pod_id=? LIMIT 1`).get(...Array.from({ length: 8 }, () => podId))
    const checkpoint = this.store.checkpoint(podId)
    if (occupied || checkpoint.revision !== 0 || canonicalNetworkJson(checkpoint.body) !== '{}') throw new Error('Added members must be separate fresh instances; historical members remain reserved')
  }

  replace(current: NetworkDefinition, draft: NetworkDraft, expectedFingerprint: string): void {
    this.store.transaction(() => {
      const review = this.preview(current, draft)
      if (review.fingerprint !== expectedFingerprint) throw new Error('Composition review changed; inspect the network again')
      if (review.issues.length) throw new Error(review.issues.join('; '))
      const next = review.candidate!
      const receipt = canonicalNetworkJson({ fingerprint: expectedFingerprint, previousRevision: current.revision, revision: next.revision, draftHash: digest(canonicalNetworkJson(draft)), previous: currentCompositionDraft(this.store, current), next: draft, added: review.added, retired: review.retired, retainedRights: this.rights(current.id), schemaChangeRequiresNewSourceVersion: next.channels.some(channel => current.channels.some(previous => previous.name === channel.name && previous.schemaVersion !== channel.schemaVersion)), freshSourceIds: next.members.filter(member => member.source && review.added.includes(member.podId)).map(member => member.podId), explicitActivationRequired: true, message: 'Reviewed composition replaced while paused; historical identities and accepted work remain preserved.' })
      const body = canonicalNetworkJson(next)
      assertNetworkQuota(this.store, Buffer.byteLength(receipt) + Buffer.byteLength(body) + 16384 * next.members.length)
      this.store.db.prepare('INSERT INTO network_revisions VALUES(?,?,?,?,?)').run(current.id, next.revision, body, digest(body), Date.now())
      this.store.db.prepare('UPDATE networks SET name=?,revision=?,activation_epoch=activation_epoch+1 WHERE id=?').run(next.name, next.revision, current.id)
      for (const member of next.members) {
        if (review.added.includes(member.podId)) {
          this.store.db.prepare('INSERT INTO network_members VALUES(?,?,?,?,?,?)').run(current.id, member.podId, member.bindingRevision, member.definitionId, member.definitionVersion, member.source?.bindingId ?? null)
          this.store.db.prepare('INSERT INTO network_checkpoints VALUES(?,?,0,\'{}\')').run(current.id, member.podId)
        }
        else if (member.source) {
          this.store.db.prepare('UPDATE network_members SET source_binding_id=coalesce(source_binding_id,?) WHERE network_id=? AND pod_id=?').run(member.source.bindingId, current.id, member.podId)
        }
        for (const declaredChannel of member.contract.takes) {
          const channel = networkSubscriptionChannel(next, member.podId, declaredChannel)
          const spec = next.channels.find(item => item.name === channel)!
          this.store.db.prepare('INSERT INTO network_subscriptions VALUES(?,?,?,?,?,?,?)').run(randomUUID(), current.id, next.revision, member.podId, channel, digest(canonicalNetworkJson({ schemaVersion: spec.schemaVersion, schema: spec.schema })), member.serialCase ? 1 : 0)
        }
      }
      this.store.db.prepare('DELETE FROM composition_config WHERE network_id=?').run(current.id)
      for (const [name, value] of Object.entries(draft.sharedValues ?? {})) this.store.db.prepare('INSERT INTO composition_config VALUES(?,?,?)').run(current.id, name, JSON.stringify(value))
      for (const member of next.members) networkConfiguration(this.store, current.id, member.podId)
      this.store.db.prepare('UPDATE network_process_previews SET consumed_at=coalesce(consumed_at,?),state=\'stopped\' WHERE network_id=? AND state=\'preview\'').run(Date.now(), current.id)
      this.store.db.prepare('INSERT INTO network_trace_events(network_id,kind,body,created_at) VALUES(?,\'composition-replaced-reviewed\',?,?)').run(current.id, receipt, Date.now())
    })
  }
}
