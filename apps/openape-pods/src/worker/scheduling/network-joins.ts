import { canonicalNetworkJson } from '../../contracts/network-json'
import { parseNetworkDefinition } from '../../contracts/networks'
import type { NetworkJoin } from '../../contracts/networks'
import type { PodDatabase } from '../storage/database'

export class NetworkJoins {
  constructor(private readonly store: PodDatabase, private readonly now: () => number = Date.now) {}

  record(eventId: string): void {
    const event = this.store.db.prepare('SELECT * FROM network_events WHERE id=?').get(eventId)
    if (!event) throw new Error('Join input event is unavailable')
    const revision = this.store.db.prepare('SELECT contract FROM network_revisions WHERE network_id=? AND revision=?').get(event.network_id!, event.network_revision!)!
    const definition = parseNetworkDefinition(JSON.parse(revision.contract as string))
    for (const join of definition.joins ?? []) {
      if (!join.channels.includes(event.channel as string)) continue
      const key: [string, string, string, number] = [String(event.network_id), join.id, String(event.case_id), Number(event.case_revision)]
      this.store.db.prepare('INSERT OR IGNORE INTO network_joins VALUES(?,?,?,?,?,?,?,\'pending\',NULL)').run(...key, event.network_revision!, canonicalNetworkJson(join), Number(event.accepted_at) + join.deadlineMs)
      const current = this.store.db.prepare('SELECT state,deadline FROM network_joins WHERE network_id=? AND join_id=? AND case_id=? AND case_revision=?').get(...key)!
      const input = this.store.db.prepare('SELECT event_id FROM network_join_inputs WHERE network_id=? AND join_id=? AND case_id=? AND case_revision=? AND channel=?').get(...key, event.channel!)
      if (input?.event_id === eventId) continue
      if (current.state !== 'pending' || Number(current.deadline) <= this.now() || input) {
        this.block(key, join, input ? 'Conflicting join input' : current.state === 'pending' ? 'Join deadline expired' : 'Late join input requires a new case revision')
        continue
      }
      this.store.db.prepare('INSERT INTO network_join_inputs VALUES(?,?,?,?,?,?)').run(...key, event.channel!, eventId)
    }
  }

  private block(key: [string, string, string, number], declaration: NetworkJoin, reason: string): void {
    const available = this.store.db.prepare('SELECT channel FROM network_join_inputs WHERE network_id=? AND join_id=? AND case_id=? AND case_revision=?').all(...key)
    const missing = declaration.channels.filter(channel => !available.some(input => input.channel === channel))
    const body = canonicalNetworkJson({ reason, missing, reviewDestination: declaration.reviewDestination })
    this.store.db.prepare('UPDATE network_joins SET state=\'blocked\',reason=? WHERE network_id=? AND join_id=? AND case_id=? AND case_revision=? AND state IN (\'pending\',\'completed\')').run(body, ...key)
    const deliveries = this.store.db.prepare(`SELECT d.id,d.state FROM network_deliveries d JOIN network_subscriptions s ON s.id=d.subscription_id
      WHERE d.network_id=? AND d.case_id=? AND d.case_revision=? AND s.pod_id=? AND d.state IN ('pending','retry_wait') AND s.channel IN (SELECT value FROM json_each(?))`).all(key[0]!, key[2]!, key[3]!, declaration.podId, JSON.stringify(declaration.channels))
    for (const delivery of deliveries) {
      this.store.db.prepare('UPDATE network_deliveries SET state=\'blocked\',reason=? WHERE id=? AND state=?').run(body, delivery.id!, delivery.state!)
      this.store.db.prepare('UPDATE network_queue_counts SET count=count-1 WHERE network_id=? AND state=?').run(key[0]!, delivery.state!)
    }
    if (deliveries.length) {
      this.store.db.prepare('INSERT INTO network_queue_counts VALUES(?,\'blocked\',?) ON CONFLICT(network_id,state) DO UPDATE SET count=count+excluded.count').run(key[0]!, deliveries.length)
    }
  }

  ready(networkId: string, revision: number, declaration: NetworkJoin, manual: boolean, gatedChannels: string[]) {
    const now = this.now()
    const rows = this.store.db.prepare(`SELECT join_row.* FROM network_joins join_row WHERE network_id=? AND network_revision=? AND join_id=?
      AND ((state='pending' AND (deadline<=? OR (SELECT count(*) FROM network_join_inputs input WHERE input.network_id=join_row.network_id AND input.join_id=join_row.join_id AND input.case_id=join_row.case_id AND input.case_revision=join_row.case_revision)=json_array_length(json_extract(declaration,'$.channels'))))
        OR (state='completed' AND EXISTS(SELECT 1 FROM network_deliveries d JOIN network_subscriptions s ON s.id=d.subscription_id WHERE d.network_id=join_row.network_id AND d.case_id=join_row.case_id AND d.case_revision=join_row.case_revision AND s.pod_id=? AND d.state='retry_wait')))
      AND NOT EXISTS(SELECT 1 FROM network_join_inputs input JOIN network_deliveries d ON d.event_id=input.event_id JOIN network_subscriptions s ON s.id=d.subscription_id
        WHERE input.network_id=join_row.network_id AND input.join_id=join_row.join_id AND input.case_id=join_row.case_id AND input.case_revision=join_row.case_revision AND s.pod_id=?
        AND s.channel IN (SELECT value FROM json_each(?)) AND d.state='pending'
        AND NOT EXISTS(SELECT 1 FROM network_gate_items item JOIN network_gate_tasks task ON task.id=item.task_id WHERE item.delivery_id=d.id AND item.outcome='released' AND task.state='approved')
        AND (SELECT count(*) FROM network_join_inputs present WHERE present.network_id=join_row.network_id AND present.join_id=join_row.join_id AND present.case_id=join_row.case_id AND present.case_revision=join_row.case_revision)=json_array_length(json_extract(join_row.declaration,'$.channels')))
      ORDER BY join_row.rowid LIMIT 100`).all(networkId, revision, declaration.id, now, declaration.podId, declaration.podId, JSON.stringify(gatedChannels))
    for (const row of rows) {
      const key: [string, string, string, number] = [networkId, declaration.id, String(row.case_id), Number(row.case_revision)]
      const inputs = this.store.db.prepare(`SELECT d.*,s.channel FROM network_join_inputs input JOIN network_deliveries d ON d.event_id=input.event_id AND d.network_id=input.network_id
        JOIN network_subscriptions s ON s.id=d.subscription_id WHERE input.network_id=? AND input.join_id=? AND input.case_id=? AND input.case_revision=? AND s.pod_id=? ORDER BY s.channel`).all(...key, declaration.podId)
      if (row.state === 'pending' && inputs.length < declaration.channels.length && Number(row.deadline) <= now) { this.block(key, declaration, 'Join deadline expired'); continue }
      if (inputs.length !== declaration.channels.length || inputs.some(input => Number(input.ready_at) > now || Number(input.attempt) >= 3)) continue
      if (inputs.every(input => input.state === 'retry_wait')) {
        const original = this.store.db.prepare('SELECT manifest FROM network_invocations WHERE run_id=?').get(inputs[0]!.run_id!)
        if (!original || inputs.some(input => input.run_id !== inputs[0]!.run_id)) { this.blockRetry(key, declaration, 'Join retry lineage changed'); continue }
        const manifest = JSON.parse(original.manifest as string)
        if (!manual && manifest.reason === 'manual') continue
        if (manifest.inputClaims.length !== inputs.length || inputs.some(input => !manifest.inputClaims.some((pin: { id: string }) => pin.id === input.id))) { this.blockRetry(key, declaration, 'Join retry inputs changed'); continue }
        return inputs
      }
      if (row.state !== 'pending' || inputs.some(input => input.state !== 'pending' || input.run_id !== null)) continue
      if (inputs.some(input => gatedChannels.includes(input.channel as string) && !this.store.db.prepare('SELECT 1 FROM network_gate_items item JOIN network_gate_tasks task ON task.id=item.task_id WHERE item.delivery_id=? AND item.outcome=\'released\' AND task.state=\'approved\'').get(input.id!))) continue
      return inputs
    }
    return []
  }

  private blockRetry(key: [string, string, string, number], declaration: NetworkJoin, reason: string): void {
    this.block(key, declaration, reason)
  }

  claim(networkId: string, declaration: NetworkJoin, caseId: string, caseRevision: number): void {
    const current = this.store.db.prepare('SELECT state FROM network_joins WHERE network_id=? AND join_id=? AND case_id=? AND case_revision=?').get(networkId, declaration.id, caseId, caseRevision)
    if (!current || !['pending', 'completed'].includes(current.state as string)) throw new Error('Join inputs require owner review before dispatch')
    this.store.db.prepare('UPDATE network_joins SET state=\'completed\' WHERE network_id=? AND join_id=? AND case_id=? AND case_revision=? AND state=\'pending\'').run(networkId, declaration.id, caseId, caseRevision)
  }
}
