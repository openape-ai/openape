import { createHash } from 'node:crypto'
import { parseOwner } from '@openape/pods-protocol'
import { DatabaseSync } from 'node:sqlite'
import { baselineSchema } from './schema.ts'

let expectedObjects: { type: string, name: string, sql: string }[] | undefined
function baselineObjects(): { type: string, name: string, sql: string }[] {
  if (expectedObjects) return expectedObjects
  const reference = new DatabaseSync(':memory:')
  try {
    reference.exec(baselineSchema)
    expectedObjects = reference.prepare('SELECT type,name,sql FROM sqlite_schema WHERE sql IS NOT NULL AND name NOT LIKE \'sqlite_%\'').all() as { type: string, name: string, sql: string }[]
    return expectedObjects
  }
  finally { reference.close() }
}

/** Each query finds a stored row that crosses a network, owner or retry boundary; the key is the error it reports. */
const networkChecks = {
  'Invalid network boundary: membership': `SELECT 1 FROM network_members m JOIN networks n ON n.id=m.network_id LEFT JOIN pod_memberships p ON p.pod_id=m.pod_id
    LEFT JOIN instance_definition_bindings b ON b.pod_id=m.pod_id LEFT JOIN pod_definitions d ON d.id=b.definition_id
    WHERE p.group_id IS NOT n.group_id OR d.id IS NULL OR d.owner_issuer!=n.owner_issuer OR d.owner_subject!=n.owner_subject LIMIT 1`,
  'Invalid network boundary: invocationPod': `SELECT 1 FROM network_invocations i JOIN runs r ON r.id=i.run_id WHERE r.pod_id!=i.pod_id LIMIT 1`,
  'Invalid network boundary: effectCase': `SELECT 1 FROM network_effect_attempts e JOIN network_invocations i ON i.run_id=e.run_id JOIN network_cases c ON c.id=e.case_id WHERE c.network_id!=i.network_id LIMIT 1`,
  'Invalid network boundary: eventDefinition': `SELECT 1 FROM network_events e JOIN networks n ON n.id=e.network_id JOIN pod_definitions d ON d.id=e.definition_id WHERE d.owner_issuer!=n.owner_issuer OR d.owner_subject!=n.owner_subject LIMIT 1`,
  'Invalid network boundary: recordAuthor': `SELECT 1 FROM data_record_revisions r JOIN network_invocations i ON i.run_id=r.author_run_id JOIN networks n ON n.id=i.network_id JOIN data_collections c ON c.id=r.collection_id JOIN pod_definitions d ON d.id=r.definition_id
    WHERE c.owner_issuer!=n.owner_issuer OR c.owner_subject!=n.owner_subject OR c.group_id!=n.group_id OR d.owner_issuer!=n.owner_issuer OR d.owner_subject!=n.owner_subject LIMIT 1`,
  'Invalid network boundary: retainedIdentity': `SELECT 1 FROM network_event_identities i JOIN network_events e ON e.id=i.event_id WHERE i.network_id!=e.network_id OR i.payload_hash!=e.payload_hash OR i.schema_hash!=e.schema_hash LIMIT 1`,
  'Invalid network boundary: effectOutcome': `SELECT 1 FROM network_effect_attempts a WHERE a.state='confirmed_not_applied' AND EXISTS(SELECT 1 FROM network_effect_receipts r WHERE r.logical_action_key=a.logical_action_key AND r.attempt=a.attempt AND r.outcome='confirmed_applied') LIMIT 1`,
  'Invalid network boundary: gateAttempt': `SELECT 1 FROM network_gate_task_attempts a JOIN network_gate_tasks t ON t.id=a.task_id JOIN network_invocations i ON i.run_id=a.run_id WHERE t.network_id!=i.network_id OR t.pod_id!=i.pod_id OR i.execution_kind!='gate_maintenance' LIMIT 1`,
  'Invalid network retry lineage': `SELECT 1 FROM network_invocation_controls c JOIN network_invocations i ON i.run_id=c.run_id JOIN network_invocations previous ON previous.run_id=c.retry_of JOIN network_invocation_controls p ON p.run_id=previous.run_id WHERE i.network_id!=previous.network_id OR i.pod_id!=previous.pod_id OR c.attempt!=p.attempt+1 LIMIT 1`,
  'Invalid network process preview scope': `SELECT 1 FROM network_invocation_controls c JOIN network_invocations i ON i.run_id=c.run_id JOIN network_process_previews p ON p.id=c.process_preview_id WHERE p.network_id!=i.network_id LIMIT 1`,
  'Invalid network gate item scope': `SELECT 1 FROM network_gate_items item JOIN network_gate_tasks task ON task.id=item.task_id
    JOIN network_deliveries delivery ON delivery.id=item.delivery_id JOIN network_subscriptions subscription ON subscription.id=delivery.subscription_id
    JOIN network_events event ON event.id=item.event_id
    WHERE delivery.network_id!=task.network_id OR event.network_id!=task.network_id OR delivery.event_id!=item.event_id
      OR subscription.pod_id!=task.pod_id OR subscription.network_revision!=task.network_revision LIMIT 1`,
  'Invalid network choice scope': `SELECT 1 FROM network_choices c
    JOIN network_revisions r ON r.network_id=c.network_id AND r.revision=c.network_revision
    JOIN network_events e ON e.id=c.event_id LEFT JOIN network_events d ON d.id=c.result_event_id
    WHERE e.network_revision!=c.network_revision OR NOT EXISTS(
      SELECT 1 FROM json_each(r.contract,'$.routes') g WHERE json_extract(g.value,'$.key')=c.gate_key
        AND json_extract(g.value,'$.kind')='choose' AND json_extract(g.value,'$.takes')=e.channel
        AND (c.option_key IS NULL OR (d.network_revision=c.network_revision AND d.case_id=e.case_id AND d.case_revision=e.case_revision
          AND d.payload_hash=e.payload_hash AND EXISTS(SELECT 1 FROM json_each(g.value,'$.options') o
            WHERE json_extract(o.value,'$.key')=c.option_key AND json_extract(o.value,'$.channel')=d.channel)))) LIMIT 1`,
}

/**
 * Every baseline table and index exists exactly as the baseline declares it. With `references`, as for an opened
 * backup, every stored reference, owner, content digest and network boundary is checked as well.
 */
export function assertIntegrity(database: DatabaseSync, references = false): void {
  for (const expected of baselineObjects()) {
    const actual = database.prepare('SELECT sql FROM sqlite_schema WHERE type=? AND name=?').get(expected.type, expected.name)
    if (actual?.sql !== expected.sql) throw new Error(`Incomplete or altered storage: ${expected.name}`)
  }
  if (!references) return
  const broken = database.prepare('PRAGMA foreign_key_check').get()
  if (broken) throw new Error(`Invalid network references: ${String(broken.table)}`)
  for (const owner of database.prepare('SELECT issuer,subject FROM network_owners').all()) parseOwner(owner)
  for (const [table, body, hash] of [['network_revisions', 'contract', 'content_hash'], ['network_events', 'payload', 'payload_hash'], ['network_gate_tasks', 'manifest', 'manifest_hash']]) {
    for (const row of database.prepare(`SELECT ${body} AS body,${hash} AS hash FROM ${table}`).iterate()) {
      if (createHash('sha256').update(String(row.body)).digest('hex') !== row.hash) throw new Error(`Invalid network content digest: ${table}`)
    }
  }
  for (const [message, query] of Object.entries(networkChecks)) {
    if (database.prepare(query).get()) throw new Error(message)
  }
}
