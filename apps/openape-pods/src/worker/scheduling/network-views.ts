import type { Owner } from '@openape/pods-protocol'
import type { NetworkDefinition } from '../../contracts/networks'
import type { NetworkDataPage, NetworkDetails, NetworkFailure, NetworkMemberView, NetworkSetup, NetworkTracePage } from '../../contracts/network-operations'
import { publicConfiguration } from '../../contracts/network-data'
import type { ResourceRegistry } from '../resources/registry'
import { canonicalNetworkJson } from '../../contracts/network-json'
import { digest, parseManifest } from '../storage/database'
import type { PodDatabase } from '../storage/database'
import { networkConfiguration } from './network-config'

export class NetworkViews {
  constructor(private readonly store: PodDatabase, private readonly resources: ResourceRegistry) {}

  member(podId: string, networkId?: string): NetworkMemberView {
    const pod = this.store.getPod(podId)
    const script = this.store.db.prepare('SELECT manifest FROM scripts WHERE pod_id=? AND hash=?').get(podId, pod.activeScript ?? '')
    const manifest = script ? parseManifest(JSON.parse(script.manifest as string)) : null
    const declarations = this.store.db.prepare(`SELECT c.name,c.kind,c.value FROM instance_definition_bindings b JOIN definition_config c
      ON c.definition_id=b.definition_id AND c.definition_version=b.definition_version WHERE b.pod_id=? ORDER BY c.name`).all(podId)
    const config = networkId ? networkConfiguration(this.store, networkId, podId) : null
    const values = (config ? Object.entries(config).map(([name, field]) => ({ name, kind: field.kind, value: JSON.stringify(field.value) })) : declarations).map((row) => {
      const effective = config?.[row.name as string] ?? null
      const kind = row.kind as 'public' | 'secret-reference'
      return { name: row.name as string, kind, origin: effective?.origin ?? 'definition', value: kind === 'secret-reference' ? null : publicConfiguration(effective ? effective.value : JSON.parse(row.value as string)) }
    })
    const resources = this.resources.list(podId)
    return { resourcesMore: resources.length > 256, podId, name: pod.name, lifecycle: pod.lifecycle, capabilities: manifest?.capabilities ?? [], triggers: manifest?.triggers ?? [], values, resources: resources.slice(0, 256).map(({ name, kind, state }) => ({ name, kind, state })) }
  }

  private detailMember(podId: string, networkId: string): NetworkMemberView {
    try { return this.member(podId, networkId) }
    catch (error) {
      const pod = this.store.getPod(podId)
      return { podId, name: pod.name, lifecycle: pod.lifecycle, diagnostic: (error instanceof Error ? error.message : String(error)).slice(0, 10000), capabilities: [], triggers: [], values: [], resources: [], resourcesMore: false }
    }
  }

  setup(owner: Owner, groupId: string, podIds: string[]): NetworkSetup {
    for (const podId of podIds) {
      const binding = this.store.db.prepare(`SELECT 1 FROM instance_definition_bindings b JOIN pod_definitions d ON d.id=b.definition_id
        JOIN pod_memberships m ON m.pod_id=b.pod_id WHERE b.pod_id=? AND m.group_id=? AND d.owner_issuer=? AND d.owner_subject=?`).get(podId, groupId, owner.issuer, owner.subject)
      if (!binding) throw new Error('Network instance definition belongs to another owner or group')
    }
    const selected = [...podIds].sort()
    const members = selected.map(id => this.member(id))
    const authority = selected.map(podId => ({ pod: this.store.getPod(podId), epoch: this.resources.epoch(podId), binding: this.store.db.prepare('SELECT * FROM instance_definition_bindings WHERE pod_id=?').get(podId) }))
    return { groupId, members, fingerprint: digest(canonicalNetworkJson({ groupId, members, authority })) }
  }

  detail(definition: NetworkDefinition): NetworkDetails {
    // A completed script with a held unknown tool outcome is listed so its effect can be reconciled.
    const failures = this.store.db.prepare(`SELECT i.run_id,i.generation,i.pod_id,CASE WHEN i.state='completed' THEN 'uncertain' ELSE c.failure_kind END AS failure_kind,
      CASE WHEN i.state='completed' THEN 'A completed run holds back inputs whose external outcome is unknown; reconcile them' ELSE c.diagnostic END AS diagnostic,c.stopped_receipt,c.review_required FROM network_invocations i
      LEFT JOIN network_invocation_controls c ON c.run_id=i.run_id WHERE i.network_id=? AND ((i.state IN ('interrupted','blocked','unknown')
      AND c.retry_consumed_at IS NULL AND c.resolved_receipt IS NULL) OR (i.state='completed' AND EXISTS(SELECT 1 FROM network_effect_attempts e WHERE e.run_id=i.run_id AND e.state='unknown'))) ORDER BY i.rowid DESC LIMIT 50`).all(definition.id)
    const collections = this.store.db.prepare(`SELECT DISTINCT c.id,c.name,c.current_version FROM data_collections c
      JOIN data_permissions p ON p.collection_id=c.id JOIN networks n ON n.id=p.network_id WHERE p.network_id=? AND c.owner_issuer=n.owner_issuer AND c.owner_subject=n.owner_subject AND c.group_id=n.group_id ORDER BY c.id LIMIT 65`).all(definition.id)
    return {
      definition, members: definition.members.map(member => this.detailMember(member.podId, definition.id)),
      failures: failures.map((row): NetworkFailure => {
        const stopped = row.stopped_receipt ? JSON.parse(row.stopped_receipt as string) : null
        const effects = this.store.db.prepare(`SELECT e.logical_action_key,e.attempt,e.state,coalesce(max(r.sequence),0) AS sequence FROM network_effect_attempts e LEFT JOIN network_effect_receipts r ON r.logical_action_key=e.logical_action_key AND r.attempt=e.attempt WHERE e.run_id=? GROUP BY e.logical_action_key,e.attempt ORDER BY e.created_at,e.logical_action_key LIMIT 51`).all(row.run_id!)
        const conflict = row.review_required ? this.store.db.prepare(`SELECT json_extract(body,'$.identityHash') AS hash FROM network_trace_events WHERE network_id=? AND run_id=? AND kind='source-identity-conflict-review' ORDER BY id DESC LIMIT 1`).get(definition.id, row.run_id!) : null
        return { runId: row.run_id as string, generation: Number(row.generation), podId: row.pod_id as string, kind: row.failure_kind as NetworkFailure['kind'] ?? 'recovery', reason: (row.diagnostic as string ?? 'Network invocation requires process and effect inspection').slice(0, 10000), inspectedAt: stopped?.generation === row.generation && Number(stopped.inspectedAt ?? stopped.at) > 0 && !this.store.db.prepare('SELECT 1 FROM run_leases WHERE run_id=?').get(row.run_id!) ? Number(stopped.inspectedAt ?? stopped.at ?? 0) : null, conflict: conflict?.hash as string ?? null, effectsMore: effects.length > 50, effects: effects.slice(0, 50).map(effect => ({ key: effect.logical_action_key as string, attempt: Number(effect.attempt), sequence: Number(effect.sequence), state: effect.state as string })) }
      }),
      collectionsMore: collections.length > 64, collections: collections.slice(0, 64).map(row => ({ id: row.id as string, name: row.name as string, version: Number(row.current_version) })),
    }
  }

  trace(networkId: string, before: number | null, caseId: string | null): NetworkTracePage {
    const rows = this.store.db.prepare(`SELECT id,case_id,run_id,kind,CASE WHEN kind='legacy-conversion-reviewed' THEN json_object('message',json_extract(body,'$.message')) ELSE body END AS body,created_at FROM network_trace_events
      WHERE network_id=? AND kind NOT IN ('environment','operation','log','snapshot','process','infrastructure') AND id<? AND (? IS NULL OR case_id=?) ORDER BY id DESC LIMIT 51`).all(networkId, before ?? Number.MAX_SAFE_INTEGER, caseId, caseId)
    const events = rows.slice(0, 50).map((row) => {
      const receipt = JSON.parse(row.body as string) as Record<string, unknown>
      const source = ['network-mail-read', 'recovery-boundary'].includes(row.kind as string) ? receipt.data as Record<string, unknown> : receipt
      const visible = Object.fromEntries(['operation', 'count', 'message', 'gate', 'decision', 'inputEventId', 'podId', 'admitted', 'expired', 'explicitResumeRequired', 'activeInvocationsMaySettle', 'state', 'summary', 'error', 'reason', 'taskId', 'generation', 'itemCount', 'channel', 'caseRevision', 'feedback', 'hop', 'delayMs', 'eventId', 'noScriptLaunched', 'explicitInspectionRequired', 'automaticRepeatDenied'].filter(key => Object.hasOwn(source, key) && (source[key] === null || ['string', 'number', 'boolean'].includes(typeof source[key]))).map(key => [key, source[key]]))
      const body = JSON.stringify(visible)
      return { id: Number(row.id), caseId: row.case_id as string | null, runId: row.run_id as string | null, kind: row.kind as string, body: body.slice(0, 8192), truncated: body.length > 8192, at: Number(row.created_at) }
    })
    return { events, before: rows.length > 50 ? events.at(-1)!.id : null }
  }

  records(definition: NetworkDefinition, collectionId: string, after: string | null): NetworkDataPage {
    const binding = this.store.db.prepare(`SELECT 1 FROM data_permissions p JOIN data_collections c ON c.id=p.collection_id JOIN networks n ON n.id=p.network_id
      WHERE p.network_id=? AND p.collection_id=? AND c.owner_issuer=n.owner_issuer AND c.owner_subject=n.owner_subject AND c.group_id=n.group_id LIMIT 1`).get(definition.id, collectionId)
    if (!binding) throw new Error('Collection is not bound to this network')
    const rows = this.store.db.prepare(`SELECT r.record_key,r.revision,v.schema_version,substr(v.body,1,196609) AS body,length(v.body)>196608 AS truncated,r.tombstone,v.created_at FROM data_records r
      JOIN data_record_revisions v ON v.collection_id=r.collection_id AND v.record_key=r.record_key AND v.revision=r.revision
      WHERE r.collection_id=? AND r.record_key>? ORDER BY r.record_key LIMIT 6`).all(collectionId, after ?? '')
    const records = rows.slice(0, 5).map(row => ({ key: row.record_key as string, revision: Number(row.revision), schemaVersion: Number(row.schema_version), body: row.body === null ? null : recordPreview(row.body as string), truncated: Boolean(row.truncated) || (typeof row.body === 'string' && Buffer.byteLength(row.body) > 32768), deleted: Boolean(row.tombstone), at: Number(row.created_at) }))
    return { collectionId, records, after: rows.length > 5 ? records.at(-1)!.key : null }
  }
}

function recordPreview(value: string): string {
  let bytes = 0; let end = 0
  for (const character of value) {
    const size = Buffer.byteLength(character)
    if (bytes + size > 32768) break
    bytes += size; end += character.length
  }
  return value.slice(0, end)
}
