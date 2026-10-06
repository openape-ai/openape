import { randomUUID } from 'node:crypto'
import { digest, PodDatabase } from '../../src/worker/storage/database.ts'
import { prototypeSchema } from './network-prototype-schema.ts'
import type { PrototypeEvent, PrototypeInvocation, PrototypeWrite } from './network-prototype-types.ts'

export class NetworkPrototype {
  readonly store: PodDatabase
  readonly boot = randomUUID()
  constructor(root: string, restored = false) {
    this.store = new PodDatabase(root)
    this.store.db.exec(prototypeSchema)
    if (restored) this.restoreBaseline()
  }

  private restoreBaseline(): void {
    this.store.transaction(() => {
      for (const row of this.store.db.prepare('SELECT id FROM prototype_networks').all()) {
        this.store.db.prepare('UPDATE prototype_networks SET state=\'paused\',restore_nonce=? WHERE id=?').run(randomUUID(), row.id)
      }
      for (const row of this.store.db.prepare('SELECT id FROM prototype_invocations WHERE state IN (\'running\',\'stopping\')').all()) {
        const id = String(row.id)
        const uncertain = this.store.db.prepare('SELECT 1 FROM prototype_effect_attempts WHERE invocation_id=? AND state=\'intent\'').get(id)
        this.store.db.prepare('UPDATE prototype_deliveries SET state=? WHERE invocation_id=?').run(uncertain ? 'unknown' : 'blocked', id)
        if (uncertain) this.unknownEffects(id)
        this.store.db.prepare('UPDATE prototype_invocations SET state=\'blocked\',token=? WHERE id=?').run(randomUUID(), id)
      }
      this.store.db.exec('DELETE FROM prototype_leases')
    })
  }

  network(id: string): void { this.store.db.prepare('INSERT INTO prototype_networks(id,restore_nonce) VALUES(?,?)').run(id, randomUUID()) }
  member(networkId: string, channels: string[] = []): string {
    const { id } = this.store.createPod({ name: 'Synthetic network member' })
    this.store.transaction(() => {
      this.store.db.prepare('INSERT INTO prototype_members VALUES(?,?)').run(networkId, id)
      for (const channel of channels) this.store.db.prepare('INSERT INTO prototype_subscriptions VALUES(?,?,?,?)').run(randomUUID(), networkId, id, channel)
      this.store.db.prepare('INSERT INTO prototype_checkpoints VALUES(?,0,\'{}\')').run(id)
    })
    return id
  }

  private reserve(networkId: string, podId: string, deliveries: string[]): PrototypeInvocation {
    const network = this.store.db.prepare('SELECT restore_nonce,activation_epoch FROM prototype_networks WHERE id=? AND state=\'active\'').get(networkId)
    const restore = network?.restore_nonce
    if (this.store.db.prepare('SELECT 1 FROM prototype_leases WHERE pod_id=?').get(podId)) throw new Error('Instance is still reserved')
    if (!restore || !this.store.db.prepare('SELECT 1 FROM prototype_members WHERE network_id=? AND pod_id=?').get(networkId, podId)) throw new Error('No active network binding')
    const invocation = { id: randomUUID(), networkId, podId, boot: this.boot, restore: String(restore), token: randomUUID(), epoch: Number(network?.activation_epoch), deliveries, generations: {} as Record<string, number> }
    this.store.db.prepare('INSERT INTO prototype_invocations VALUES(?,?,?,?,?,?,?,\'running\')').run(invocation.id, networkId, podId, invocation.boot, invocation.restore, invocation.token, invocation.epoch)
    this.store.db.prepare('INSERT INTO prototype_leases VALUES(?,?)').run(podId, invocation.id)
    for (const id of deliveries) {
      const update = this.store.db.prepare('UPDATE prototype_deliveries SET state=\'claimed\',invocation_id=?,generation=generation+1 WHERE id=? AND state=\'pending\'').run(invocation.id, id)
      if (update.changes !== 1) throw new Error('Delivery is not ready')
      invocation.generations[id] = Number(this.store.db.prepare('SELECT generation FROM prototype_deliveries WHERE id=?').get(id)?.generation)
    }
    return invocation
  }

  source(networkId: string, podId: string): PrototypeInvocation { return this.store.transaction(() => this.reserve(networkId, podId, [])) }
  claim(networkId: string, podId: string, limit = 50): PrototypeInvocation | null {
    return this.store.transaction(() => {
      if (this.store.db.prepare('SELECT 1 FROM prototype_leases WHERE pod_id=?').get(podId)) return null
      const deliveries = this.store.db.prepare(`SELECT d.id FROM prototype_deliveries d JOIN prototype_subscriptions s ON s.id=d.subscription_id JOIN prototype_events e ON e.id=d.event_id WHERE s.network_id=? AND s.pod_id=? AND d.state='pending' ORDER BY e.accepted_at,e.rowid,d.rowid LIMIT ?`).all(networkId, podId, limit).map(row => String(row.id))
      return deliveries.length ? this.reserve(networkId, podId, deliveries) : null
    })
  }

  assertCurrent(invocation: PrototypeInvocation): void {
    const row = this.store.db.prepare(`SELECT i.* FROM prototype_invocations i JOIN prototype_leases l ON l.invocation_id=i.id JOIN prototype_networks n ON n.id=i.network_id JOIN prototype_members m ON m.network_id=i.network_id AND m.pod_id=i.pod_id WHERE i.id=? AND i.state='running' AND i.token=? AND i.boot=? AND i.restore_nonce=n.restore_nonce AND i.activation_epoch=n.activation_epoch`).get(invocation.id, invocation.token, this.boot)
    if (!row || row.pod_id !== invocation.podId || row.network_id !== invocation.networkId || row.restore_nonce !== invocation.restore || invocation.boot !== this.boot) throw new Error('Obsolete invocation authority')
    for (const id of invocation.deliveries) {
      if (!this.store.db.prepare('SELECT 1 FROM prototype_deliveries WHERE id=? AND invocation_id=? AND generation=? AND state=\'claimed\'').get(id, invocation.id, invocation.generations[id])) throw new Error('Obsolete delivery authority')
    }
  }

  private accept(networkId: string, namespace: string, identity: unknown[], event: PrototypeEvent, now: number): string {
    const identityHash = digest(JSON.stringify(identity)); const body = JSON.stringify(event.payload); const payloadHash = digest(body)
    const existing = this.store.db.prepare('SELECT event_id,payload_hash FROM prototype_identities WHERE network_id=? AND namespace=? AND identity_hash=?').get(networkId, namespace, identityHash)
    if (existing) {
      if (existing.payload_hash !== payloadHash) throw new Error('Event identity has conflicting content')
      return String(existing.event_id)
    }
    const id = randomUUID()
    this.store.db.prepare('INSERT INTO prototype_identities VALUES(?,?,?,?,?,?)').run(networkId, namespace, identityHash, id, payloadHash, now)
    this.store.db.prepare('INSERT INTO prototype_events VALUES(?,?,?,?,?,?)').run(id, networkId, event.channel, event.key, body, now)
    for (const subscriber of this.store.db.prepare('SELECT id FROM prototype_subscriptions WHERE network_id=? AND channel=?').all(networkId, event.channel)) this.store.db.prepare('INSERT INTO prototype_deliveries(id,event_id,subscription_id) VALUES(?,?,?)').run(randomUUID(), id, subscriber.id)
    return id
  }

  acceptSource(invocation: PrototypeInvocation, binding: string, items: PrototypeEvent[], expectedCheckpoint: number, checkpoint: unknown, observe: () => void = () => {}): string[] {
    return this.store.transaction(() => {
      this.assertCurrent(invocation)
      const ids = items.map(item => this.accept(invocation.networkId, 'source', [invocation.networkId, binding, item.key, item.sourceVersion, item.channel], item, Date.now()))
      this.checkpoint(invocation, expectedCheckpoint, checkpoint)
      this.finish(invocation)
      observe()
      return ids
    })
  }

  items(invocation: PrototypeInvocation): (PrototypeEvent & { eventId: string })[] {
    return invocation.deliveries.map((id) => {
      const row = this.store.db.prepare('SELECT e.* FROM prototype_deliveries d JOIN prototype_events e ON e.id=d.event_id WHERE d.id=? AND d.invocation_id=?').get(id, invocation.id)
      if (!row) throw new Error('Input is not owned by this invocation')
      return { eventId: String(row.id), key: String(row.item_key), channel: String(row.channel), payload: JSON.parse(String(row.payload)), sourceVersion: 'derived' }
    })
  }

  private checkpoint(invocation: PrototypeInvocation, expectedRevision: number, body: unknown): void {
    const result = this.store.db.prepare('UPDATE prototype_checkpoints SET revision=revision+1,body=? WHERE pod_id=? AND revision=?').run(JSON.stringify(body), invocation.podId, expectedRevision)
    if (result.changes !== 1) throw new Error('Checkpoint conflict')
  }

  private finish(invocation: PrototypeInvocation): void {
    this.store.db.prepare('UPDATE prototype_invocations SET state=\'completed\' WHERE id=?').run(invocation.id)
    this.store.db.prepare('DELETE FROM prototype_leases WHERE invocation_id=?').run(invocation.id)
  }

  settle(invocation: PrototypeInvocation, emits: PrototypeEvent[] = [], writes: PrototypeWrite[] = [], observe: () => void = () => {}): void {
    this.store.transaction(() => {
      this.assertCurrent(invocation)
      if (this.store.db.prepare('SELECT 1 FROM prototype_effect_attempts WHERE invocation_id=? AND state IN (\'intent\',\'unknown\')').get(invocation.id)) throw new Error('Unresolved external effect prevents settlement')
      const inputs = this.items(invocation).map(item => item.eventId).sort()
      for (const write of writes) {
        const current = this.store.db.prepare('SELECT revision FROM prototype_records WHERE network_id=? AND item_key=?').get(invocation.networkId, write.key)
        if (Number(current?.revision ?? 0) !== write.expectedRevision) throw new Error('Record revision conflict')
        const revision = write.expectedRevision + 1; const body = JSON.stringify(write.value)
        this.store.db.prepare('INSERT INTO prototype_records VALUES(?,?,?,?) ON CONFLICT(network_id,item_key) DO UPDATE SET revision=excluded.revision,body=excluded.body').run(invocation.networkId, write.key, revision, body)
        this.store.db.prepare('INSERT INTO prototype_record_revisions VALUES(?,?,?,?,?)').run(invocation.networkId, write.key, revision, invocation.id, body)
      }
      for (const emit of emits) {
        const causes = [...new Set(emit.inputEventIds ?? inputs)].sort()
        if (!causes.length || causes.some(id => !inputs.includes(id))) throw new Error('Emit requires owned causal inputs')
        this.accept(invocation.networkId, 'derived', [invocation.networkId, invocation.podId, causes, emit.channel, emit.key, 'no-feedback'], emit, Date.now())
      }
      for (const id of invocation.deliveries) this.store.db.prepare('UPDATE prototype_deliveries SET state=\'done\' WHERE id=? AND invocation_id=?').run(id, invocation.id)
      const revision = Number(this.store.db.prepare('SELECT revision FROM prototype_checkpoints WHERE pod_id=?').get(invocation.podId)?.revision)
      this.checkpoint(invocation, revision, { inputs })
      this.finish(invocation)
      observe()
    })
  }

  cancel(invocation: PrototypeInvocation): void {
    this.store.transaction(() => {
      this.assertCurrent(invocation)
      this.store.db.prepare('UPDATE prototype_invocations SET state=\'stopping\',token=? WHERE id=?').run(randomUUID(), invocation.id)
    })
  }

  stop(invocation: PrototypeInvocation, processStopped: boolean): void {
    if (!processStopped) throw new Error('Prove process termination before reassignment')
    this.store.transaction(() => {
      const row = this.store.db.prepare('SELECT i.* FROM prototype_invocations i JOIN prototype_leases l ON l.invocation_id=i.id WHERE i.id=? AND i.state IN (\'running\',\'stopping\')').get(invocation.id)
      if (!row || row.boot !== this.boot || row.pod_id !== invocation.podId || row.network_id !== invocation.networkId || row.restore_nonce !== invocation.restore || (row.state === 'running' && row.token !== invocation.token)) throw new Error('Obsolete termination authority')
      const uncertain = this.store.db.prepare('SELECT 1 FROM prototype_effect_attempts WHERE invocation_id=? AND state=\'intent\'').get(invocation.id)
      this.store.db.prepare('UPDATE prototype_invocations SET state=\'interrupted\',token=? WHERE id=?').run(randomUUID(), invocation.id)
      this.store.db.prepare('UPDATE prototype_deliveries SET state=?,invocation_id=? WHERE invocation_id=?').run(uncertain ? 'unknown' : 'pending', uncertain ? invocation.id : null, invocation.id)
      this.store.db.prepare('DELETE FROM prototype_leases WHERE invocation_id=?').run(invocation.id)
      if (uncertain) this.unknownEffects(invocation.id)
    })
  }

  private unknownEffects(invocationId: string): void {
    for (const effect of this.store.db.prepare('SELECT * FROM prototype_effect_attempts WHERE invocation_id=? AND state=\'intent\'').all(invocationId)) {
      this.store.db.prepare('UPDATE prototype_effect_attempts SET state=\'unknown\' WHERE logical_key=? AND attempt=?').run(effect.logical_key, effect.attempt)
      this.store.db.prepare('INSERT INTO prototype_effect_receipts VALUES(?,?,2,\'unknown\')').run(effect.logical_key, effect.attempt)
    }
  }

  recoverStoppedProcesses(): void {
    this.store.transaction(() => {
      for (const row of this.store.db.prepare('SELECT id FROM prototype_invocations WHERE state IN (\'running\',\'stopping\') AND boot<>?').all(this.boot)) {
        const id = String(row.id); const uncertain = this.store.db.prepare('SELECT 1 FROM prototype_effect_attempts WHERE invocation_id=? AND state=\'intent\'').get(id)
        this.store.db.prepare('UPDATE prototype_deliveries SET state=?,invocation_id=? WHERE invocation_id=?').run(uncertain ? 'unknown' : 'pending', uncertain ? id : null, id)
        if (uncertain) this.unknownEffects(id)
        this.store.db.prepare('UPDATE prototype_invocations SET state=\'interrupted\',token=? WHERE id=?').run(randomUUID(), id)
        this.store.db.prepare('DELETE FROM prototype_leases WHERE invocation_id=?').run(id)
      }
    })
  }

  beginEffect(invocation: PrototypeInvocation, businessKey: string, action: 'synthetic-write'): boolean {
    return this.store.transaction(() => {
      this.assertCurrent(invocation)
      const key = digest(JSON.stringify([invocation.networkId, invocation.podId, businessKey, action]))
      const existing = this.store.db.prepare('SELECT * FROM prototype_effect_attempts WHERE logical_key=? ORDER BY attempt DESC LIMIT 1').get(key)
      if (existing && existing.state !== 'completed' && existing.state !== 'not_applied') throw new Error('External effect requires reconciliation')
      const inputDigest = digest(JSON.stringify(this.items(invocation).filter(item => item.key === businessKey).map(item => [item.eventId, item.payload]).sort((a, b) => String(a[0]).localeCompare(String(b[0])))))
      if (existing && existing.input_digest !== inputDigest) throw new Error('Effect input digest conflict')
      if (existing?.state === 'completed') return false
      const attempt = Number(existing?.attempt ?? 0) + 1
      this.store.db.prepare('INSERT INTO prototype_effect_attempts VALUES(?,?,?,\'intent\',?)').run(key, attempt, invocation.id, inputDigest)
      this.store.db.prepare('INSERT INTO prototype_effect_receipts VALUES(?,?,1,\'intent\')').run(key, attempt)
      return true
    })
  }

  completeEffect(invocation: PrototypeInvocation, businessKey: string, action: 'synthetic-write'): void {
    this.store.transaction(() => {
      this.assertCurrent(invocation)
      const key = digest(JSON.stringify([invocation.networkId, invocation.podId, businessKey, action]))
      const effect = this.store.db.prepare('SELECT attempt FROM prototype_effect_attempts WHERE logical_key=? AND invocation_id=? AND state=\'intent\'').get(key, invocation.id)
      if (!effect) throw new Error('Effect intent is not owned by this invocation')
      const result = this.store.db.prepare('UPDATE prototype_effect_attempts SET state=\'completed\' WHERE logical_key=? AND invocation_id=? AND state=\'intent\'').run(key, invocation.id)
      if (result.changes !== 1) throw new Error('Effect intent is not owned by this invocation')
      this.store.db.prepare('INSERT INTO prototype_effect_receipts VALUES(?,?,2,\'completed\')').run(key, effect.attempt)
    })
  }

  confirmNotApplied(logicalKey: string, attempt: number, expectedRestore: string, reviewed: boolean): void {
    if (!reviewed) throw new Error('Explicit reconciliation required')
    this.store.transaction(() => {
      const effect = this.store.db.prepare('SELECT i.id,n.restore_nonce FROM prototype_effect_attempts e JOIN prototype_invocations i ON i.id=e.invocation_id JOIN prototype_networks n ON n.id=i.network_id WHERE e.logical_key=? AND e.attempt=?').get(logicalKey, attempt)
      if (!effect || effect.restore_nonce !== expectedRestore) throw new Error('Stale reconciliation incarnation')
      const result = this.store.db.prepare('UPDATE prototype_effect_attempts SET state=\'not_applied\' WHERE logical_key=? AND attempt=? AND state=\'unknown\'').run(logicalKey, attempt)
      if (result.changes !== 1) throw new Error('Stale reconciliation decision')
      this.store.db.prepare('INSERT INTO prototype_effect_receipts VALUES(?,?,3,\'not_applied\')').run(logicalKey, attempt)
      if (!this.store.db.prepare('SELECT 1 FROM prototype_effect_attempts WHERE invocation_id=? AND state IN (\'intent\',\'unknown\')').get(effect.id)) {
        this.store.db.prepare('UPDATE prototype_deliveries SET state=\'pending\',invocation_id=NULL WHERE invocation_id=? AND state IN (\'unknown\',\'blocked\')').run(effect.id)
      }
    })
  }

  projection(): unknown {
    return this.store.db.prepare('SELECT network_id,state,count FROM prototype_queue_counts WHERE count>0 ORDER BY network_id,state').all()
  }

  prune(before: number): void {
    this.store.transaction(() => {
      this.store.db.prepare(`DELETE FROM prototype_deliveries WHERE state='done' AND event_id IN (SELECT id FROM prototype_events WHERE accepted_at<?)`).run(before)
      this.store.db.prepare('DELETE FROM prototype_events WHERE accepted_at<? AND NOT EXISTS(SELECT 1 FROM prototype_deliveries d WHERE d.event_id=prototype_events.id)').run(before)
    })
  }

  close(): void { this.store.close() }
}
