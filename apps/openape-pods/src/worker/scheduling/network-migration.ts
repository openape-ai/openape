import { parseSchedule } from '../../contracts/scheduling'
import { parseConversionSelection } from '../../contracts/network-migration'
import type { ConversionSelection, ConversionPreview } from '../../contracts/network-migration'
import { parseOwner, sameOwner } from '@openape/pods-protocol'
import type { Owner } from '@openape/pods-protocol'
import { canonicalNetworkJson } from '../../contracts/network-json'
import { diagnoseNetwork, parseNetworkCommand, parseNetworkDefinition } from '../../contracts/networks'
import type { WorkflowDefinition } from '../../contracts/workflows'
import type { NetworkDefinition } from '../../contracts/networks'
import { parseGraphContract } from '../../contracts/graphs'
import { workflowDefinitions } from '../workflows/engine'
import { digest, parseManifest } from '../storage/database'
import type { PodDatabase } from '../storage/database'
import type { ResourceRegistry } from '../resources/registry'
import { validateNetworkComposition } from './network-composition'
import { assertNetworkQuota } from './network-quota'
import { NetworkViews } from './network-views'

export function previewNetworkConversion(store: PodDatabase, resources: ResourceRegistry, ownerValue: Owner, input: ConversionSelection): ConversionPreview {
  const selection = parseConversionSelection(input)
  const owner = parseOwner(ownerValue)
  const parsed = parseNetworkCommand({ type: 'create', draft: selection.draft })
  if (parsed.type !== 'create') throw new Error('Invalid conversion draft')
  const draft = parsed.draft
  const legacy = workflowDefinitions(store).find(item => item.id === selection.workflowId)
  if (!legacy || legacy.revision !== selection.revision) throw new Error('Legacy workflow changed; review conversion again')
  if (legacy.mode !== 'channels' || !legacy.groupId || legacy.groupId !== draft.groupId) throw new Error('Conversion requires a channel graph in its original company')
  const podIds = legacy.nodes.map(node => node.podId).sort()
  if (canonicalNetworkJson(podIds) !== canonicalNetworkJson(draft.members.map(member => member.podId).sort())) throw new Error('Conversion must preserve every legacy Pod instance')
  if (!['block', 'retainLegacy'].includes(selection.pending)) throw new Error('Choose how pending legacy items will be retained')
  const issues: string[] = []
  const ids = JSON.stringify(podIds)
  const has = (sql: string, ...values: (string | number)[]) => !!store.db.prepare(sql).get(...values)
  issues.push(...unsettledConversionIssues(store, legacy, ids, draft.groupId))
  const retained = retainedLegacyDeliveries(store, legacy.id)
  if (retained.length > 10000) issues.push('Reconcile legacy pending work below 10000 deliveries before conversion')
  const pending = Number(store.db.prepare(`SELECT count(*) AS count FROM graph_deliveries d JOIN graph_items i ON i.id=d.item_id WHERE i.workflow_id=? AND d.state='pending'`).get(legacy.id)!.count)
  if (pending && selection.pending === 'block') issues.push('Review retaining pending deliveries in the disabled legacy graph without replay')
  if (canonicalNetworkJson(legacy.channels.map(channel => channel.name).sort()) !== canonicalNetworkJson(draft.channels.map(channel => channel.name).sort())) issues.push('Preserve the declared channel names and supply an explicit schema for each')
  if (legacy.values.some(value => Object.hasOwn(draft.sharedValues ?? {}, value.name) && typeof draft.sharedValues![value.name] !== 'string')) issues.push('Legacy graph values are strings; retain a matching public string declaration instead of changing their type')
  if (legacy.values.some(value => draft.sharedValues?.[value.name] !== value.value)) issues.push('Explicitly preserve every legacy graph value in the reviewed network configuration')

  const memberViews = new NetworkViews(store, resources)
  const authority = podIds.map((podId) => {
    const pod = store.getPod(podId)
    const remote = store.db.prepare('SELECT owner FROM remote_pods WHERE pod_id=?').get(podId)
    if (remote && !sameOwner(parseOwner(JSON.parse(remote.owner as string)), owner)) throw new Error('A legacy Pod belongs to another owner')
    const binding = store.db.prepare(`SELECT b.*,v.contract,v.content_hash,v.lock_hash,d.owner_issuer,d.owner_subject FROM instance_definition_bindings b
      JOIN pod_definition_versions v ON v.definition_id=b.definition_id AND v.version=b.definition_version JOIN pod_definitions d ON d.id=b.definition_id WHERE b.pod_id=?`).get(podId)
    if (!binding || !sameOwner({ issuer: binding.owner_issuer as string, subject: binding.owner_subject as string }, owner)) throw new Error('Adopt the existing definition under this owner before reviewing conversion')
    if (store.db.prepare('SELECT group_id FROM pod_memberships WHERE pod_id=?').get(podId)?.group_id !== draft.groupId) throw new Error('Every legacy Pod must remain in the original company')
    const row = store.db.prepare('SELECT manifest FROM scripts WHERE pod_id=? AND hash=?').get(podId, pod.activeScript ?? '')
    if (!row) throw new Error('Every legacy member requires its existing active script')
    const manifest = parseManifest(JSON.parse(row.manifest as string))
    const contract = parseGraphContract(manifest.contract)
    const chosen = draft.members.find(member => member.podId === podId)!
    if (pod.lifecycle === 'archived' || pod.activeScript !== binding.content_hash || manifest.dependencyLockHash !== binding.lock_hash || canonicalNetworkJson(contract) !== canonicalNetworkJson(JSON.parse(binding.contract as string))) issues.push(`${pod.name}: active script differs from its adopted definition`)
    if (manifest.capabilities.some(capability => capability !== 'mail.read')) issues.push(`${pod.name}: rights need a supported persistent runtime port`)
    if (!chosen.source && (!manifest.triggers.includes('event') || manifest.capabilities.includes('mail.read'))) issues.push(`${pod.name}: consumer requires an event trigger and cannot perform source mail intake`)
    if (chosen.source?.schedule && !manifest.triggers.includes('schedule')) issues.push(`${pod.name}: source script does not allow scheduled execution`)
    if (!has('SELECT 1 FROM validations WHERE pod_id=? AND script_hash=? AND assignment_revision=? AND resource_epoch=?', podId, pod.activeScript!, pod.bindingRevision, resources.epoch(podId))) issues.push(`${pod.name}: validate the current script and local rights first`)
    for (const value of legacy.values) {
      const override = store.db.prepare('SELECT value FROM instance_config WHERE pod_id=? AND name=?').get(podId, value.name)
      if (override && JSON.parse(override.value as string) !== value.value) issues.push('A Pod override conflicts with a retained legacy value; reconcile the configuration before conversion')
    }
    const checkpoint = store.checkpoint(podId)
    const checkpointBody = canonicalNetworkJson(checkpoint.body)
    const checkpointHash = digest(checkpointBody)
    if (Buffer.byteLength(checkpointBody) > 64 * 1024) issues.push(`${pod.name}: checkpoint exceeds the persistent runtime limit; reconcile its baseline first`)
    if (chosen.source && canonicalNetworkJson(checkpoint.body) === '{}' && (checkpoint.revision !== 0 || has('SELECT 1 FROM runs WHERE pod_id=? UNION ALL SELECT 1 FROM accepted_events WHERE pod_id=? UNION ALL SELECT 1 FROM workflow_nodes WHERE pod_id=? AND run_id IS NOT NULL UNION ALL SELECT 1 FROM effect_ledger WHERE pod_id=? UNION ALL SELECT 1 FROM graph_items WHERE node=? LIMIT 1', podId, podId, podId, podId, podId))) issues.push(`${pod.name}: historical source items have no checkpoint baseline; reconcile the provider baseline before conversion`)
    const selected = selection.checkpoints.filter(item => item.podId === podId)
    if (selected.length !== 1 || selected[0]!.revision !== checkpoint.revision || selected[0]!.hash !== checkpointHash || selected[0]!.scriptHash !== pod.activeScript || selected[0]!.explicitSourceVersions !== !!chosen.source) issues.push(`${pod.name}: explicitly review the exact existing checkpoint and source versioning; no cursor is inferred`)
    return { pod, binding, checkpoint, checkpointHash, latestRun: store.db.prepare('SELECT id,state,started_at,finished_at FROM runs WHERE pod_id=? ORDER BY started_at DESC,rowid DESC LIMIT 1').get(podId) ?? null, schedule: store.db.prepare('SELECT * FROM schedules WHERE pod_id=?').get(podId) ?? null, resources: resources.list(podId), epoch: resources.epoch(podId), variables: store.db.prepare('SELECT * FROM pod_variables WHERE pod_id=? ORDER BY name').all(podId), configuration: store.db.prepare('SELECT * FROM instance_config WHERE pod_id=? ORDER BY name').all(podId), contract }
  })
  for (const value of legacy.values) {
    const declarations = store.db.prepare('SELECT c.kind,c.value FROM instance_definition_bindings b JOIN definition_config c ON c.definition_id=b.definition_id AND c.definition_version=b.definition_version WHERE b.pod_id IN (SELECT value FROM json_each(?)) AND c.name=?').all(ids, value.name)
    if (!declarations.length || declarations.some(field => field.kind !== 'public' || typeof JSON.parse(field.value as string) !== 'string')) issues.push('Declare each legacy graph value as a public string field in its Pod definitions before conversion')
  }
  if (selection.checkpoints.some(item => !podIds.includes(item.podId))) throw new Error('Checkpoint review contains a foreign Pod')
  let candidate: NetworkDefinition | null = null
  try {
    candidate = parseNetworkDefinition({ formatVersion: draft.joins ? 3 : draft.gates ? 2 : 1, kind: 'network', semantics: 'persistent-network-v1', id: legacy.id, revision: 1, name: draft.name, groupId: draft.groupId, channels: draft.channels, ...(draft.gates || draft.joins ? { gates: draft.gates ?? [] } : {}), ...(draft.joins ? { joins: draft.joins } : {}), members: draft.members.map((chosen) => {
      const member = authority.find(item => item.pod.id === chosen.podId)!
      return { podId: chosen.podId, definitionId: member.binding.definition_id, definitionVersion: member.binding.definition_version, bindingRevision: member.binding.binding_revision, contract: member.contract, source: chosen.source ? { bindingId: chosen.podId, schedule: chosen.source.schedule } : null, serialCase: chosen.serialCase }
    }) })
    validateNetworkComposition(store, resources, owner, draft, candidate)
    const receiptBytes = Buffer.byteLength(canonicalNetworkJson({ legacy, retained, checkpoints: authority.map(item => item.checkpoint) })) + 32768
    store.assertStorage(receiptBytes + Buffer.byteLength(canonicalNetworkJson(candidate)))
    assertNetworkQuota(store, receiptBytes + Buffer.byteLength(canonicalNetworkJson(candidate)) + 16384 * candidate.members.length)
    if (diagnoseNetwork(candidate).length) issues.push('The proposed network has blocking channel diagnostics')
  }
  catch (error) { issues.push(error instanceof Error ? error.message : String(error)) }
  const uniqueIssues = [...new Set(issues)]
  const fingerprint = digest(canonicalNetworkJson({ owner, legacy, selection: { ...selection, draft }, authority, pending, retained, issues: uniqueIssues }))
  return {
    fingerprint, legacy, draft, candidate, issues: uniqueIssues, pending,
    members: authority.map(item => ({ ...memberViews.member(item.pod.id), checkpoint: { revision: item.checkpoint.revision, hash: item.checkpointHash, scriptHash: item.pod.activeScript!, body: canonicalNetworkJson(item.checkpoint.body).slice(0, 65536), truncated: canonicalNetworkJson(item.checkpoint.body).length > 65536 }, schedule: item.schedule ? { spec: parseSchedule(JSON.parse(item.schedule.spec as string)), revision: Number(item.schedule.revision), enabled: item.schedule.enabled === 1, nextAt: item.schedule.next_at === null ? null : Number(item.schedule.next_at) } : null })),
    differences: ['The old graph and individual schedules are disabled atomically.', 'The new network remains paused until separate activation.', 'Existing identities, scripts, local bindings and historical receipts are retained.', 'Pending legacy deliveries are retained without importing or replaying them.', 'Browser publication of the ancestor graph becomes private network history.', 'Sources must already emit explicit item identities and versions; legacy source emit calls are refused at runtime.'],
  }
}

function unsettledConversionIssues(store: PodDatabase, legacy: WorkflowDefinition, ids: string, groupId: string): string[] {
  const issues: string[] = []
  const has = (sql: string, ...values: (string | number)[]) => !!store.db.prepare(sql).get(...values)
  if (legacy.mail) issues.push('Mail workflow configuration requires a separately reviewed adapter')
  if (legacy.gates.length) issues.push('Legacy gate channels cannot be rewritten without changing scripts; retain this graph until a supported adapter is available')
  if (has('SELECT 1 FROM workflow_runs WHERE workflow_id=? AND finished_at IS NULL', legacy.id)) issues.push('Settle the active workflow run before conversion')
  if (has('SELECT 1 FROM workflow_revisions WHERE workflow_id=?', legacy.id)) issues.push('Published callable workflows cannot transfer their instances to a network')
  if (has('SELECT 1 FROM network_members WHERE pod_id IN (SELECT value FROM json_each(?))', ids)) issues.push('A selected Pod already belongs to network work')
  if (has('SELECT 1 FROM workflow_members WHERE pod_id IN (SELECT value FROM json_each(?)) AND workflow_id!=?', ids, legacy.id)) issues.push('A selected Pod belongs to another legacy workflow')
  if (has('SELECT 1 FROM networks WHERE group_id=? AND state!=\'archived\'', groupId)) issues.push('The company already has a persistent network')
  for (const table of ['run_leases', 'program_leases', 'workflow_reservations']) {
    if (has(`SELECT 1 FROM ${table} WHERE pod_id IN (SELECT value FROM json_each(?))`, ids)) issues.push('Wait for all member executions and reservations to settle')
  }
  if (has('SELECT 1 FROM accepted_events WHERE pod_id IN (SELECT value FROM json_each(?)) AND state IN (\'pending\',\'claimed\',\'blocked\')', ids)) issues.push('Resolve pending standalone inputs before conversion')
  if (has('SELECT 1 FROM runs WHERE pod_id IN (SELECT value FROM json_each(?)) AND finished_at IS NULL', ids)) issues.push('Settle every unfinished member run before conversion')
  if (has(`SELECT 1 FROM runs r WHERE r.pod_id IN (SELECT value FROM json_each(?)) AND r.state!='completed' AND NOT EXISTS(SELECT 1 FROM runs newer WHERE newer.pod_id=r.pod_id AND (newer.started_at>r.started_at OR (newer.started_at=r.started_at AND newer.rowid>r.rowid)))`, ids)) issues.push('Resolve the latest unsuccessful member run before conversion')
  if (has('SELECT 1 FROM effect_ledger WHERE pod_id IN (SELECT value FROM json_each(?)) AND state!=\'completed\'', ids)) issues.push('Reconcile uncertain external effects before conversion')
  if (has('SELECT 1 FROM graph_gate_batches WHERE workflow_id=? AND state IN (\'preparing\',\'pending\',\'consuming\',\'unknown\')', legacy.id)) issues.push('Resolve every pending or uncertain legacy approval before conversion')
  if (has(`SELECT 1 FROM recovery_reviews v JOIN runs r ON r.id=v.run_id WHERE r.pod_id IN (SELECT value FROM json_each(?)) AND (v.state!='retryQueued' OR NOT EXISTS(SELECT 1 FROM accepted_events a WHERE a.id=v.request_event_id AND a.state='processed'))`, ids)) issues.push('Complete the member recovery review before conversion')
  if (has(`SELECT 1 FROM control_changes c,json_each(c.body,'$.targets') t WHERE json_extract(c.body,'$.state') IN ('pending','running') AND json_extract(t.value,'$.podId') IN (SELECT value FROM json_each(?))`, ids)) issues.push('Resolve pending control changes before conversion')
  return issues
}

export function retainedLegacyDeliveries(store: PodDatabase, workflowId: string) {
  return store.db.prepare(`SELECT i.id,i.key,i.payload,d.node FROM graph_deliveries d JOIN graph_items i ON i.id=d.item_id WHERE i.workflow_id=? AND d.state='pending' ORDER BY i.id,d.node LIMIT 10001`).all(workflowId).map(row => ({ itemId: row.id as string, node: row.node as string, key: row.key as string, payloadHash: digest(row.payload as string) }))
}
