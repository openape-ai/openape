import { randomUUID } from 'node:crypto'
import { parseSchedule } from '../../contracts/scheduling'
import type { ScheduleSpec, ScheduleView } from '../../contracts/scheduling'
import type { PodDatabase } from '../storage/database'
import type { RunTrigger } from '../runs/store'
import { nextDue } from './clock'

interface Driver { start: (podId: string, trigger: RunTrigger) => string }
export class Scheduler {
  constructor(private readonly store: PodDatabase, private readonly driver: Driver, private readonly now: () => number = Date.now) {}

  view(podId: string): ScheduleView {
    this.store.getPod(podId)
    const row = this.store.db.prepare('SELECT * FROM schedules WHERE pod_id=?').get(podId)
    const count = (state: string) => this.store.db.prepare('SELECT count(*) AS count FROM accepted_events WHERE pod_id=? AND state=?').get(podId, state)!.count as number
    return { spec: row ? parseSchedule(JSON.parse(row.spec as string)) : null, enabled: row?.enabled === 1, revision: row?.revision as number ?? 0, nextAt: row?.next_at as number | null ?? null, error: row?.error as string | null ?? this.store.db.prepare('SELECT o.error FROM reference_observations o JOIN resources r ON r.id=o.resource_id AND r.pod_id=o.pod_id WHERE o.pod_id=? AND o.error IS NOT NULL AND r.state=\'ready\' LIMIT 1').get(podId)?.error as string | null ?? this.store.db.prepare('SELECT error FROM accepted_events WHERE pod_id=? AND state=\'blocked\' ORDER BY sequence LIMIT 1').get(podId)?.error as string | null ?? null, pending: count('pending'), blocked: count('blocked'), concurrency: this.store.db.prepare('SELECT concurrency FROM settings WHERE id=1').get()!.concurrency as number }
  }

  save(podId: string, revision: number, spec: ScheduleSpec, enabled: boolean): void {
    const pod = this.store.getPod(podId); const parsed = parseSchedule(spec)
    if (pod.lifecycle === 'archived') throw new Error('Archived pods cannot accept schedules')
    this.store.transaction(() => {
      if (this.view(podId).revision !== revision) throw new Error('Stale schedule revision')
      this.store.db.prepare('INSERT INTO schedules VALUES(?,?,?,?,?,NULL) ON CONFLICT(pod_id) DO UPDATE SET revision=excluded.revision,spec=excluded.spec,enabled=excluded.enabled,next_at=excluded.next_at,error=NULL').run(podId, revision + 1, JSON.stringify(parsed), Number(enabled), nextDue(parsed, null, this.now()))
    })
  }

  lifecycle(podId: string, revision: number, lifecycle: 'active' | 'paused'): void {
    if (!['active', 'paused'].includes(lifecycle)) throw new Error('Invalid lifecycle')
    const result = this.store.db.prepare('UPDATE pods SET lifecycle=? WHERE id=? AND revision=? AND lifecycle!=\'archived\'').run(lifecycle, podId, revision)
    if (result.changes !== 1) throw new Error('Pod changed or is archived')
  }

  concurrency(maximum: number): void {
    if (!Number.isSafeInteger(maximum) || maximum < 1 || maximum > 16) throw new Error('Concurrency must be between 1 and 16')
    this.store.db.prepare('UPDATE settings SET concurrency=? WHERE id=1').run(maximum)
  }

  acceptEvent(podId: string, source: string, key: string, payload: unknown): string {
    const pod = this.store.getPod(podId)
    if (pod.lifecycle === 'archived') throw new Error('Archived pods do not accept events')
    if (!/^[a-z][a-z0-9.-]{0,80}$/.test(source) || !key || key.length > 200 || /[\0\r\n]/.test(key)) throw new Error('Invalid event identity')
    const encoded = JSON.stringify(payload)
    if (!encoded || Buffer.byteLength(encoded) > 32768) throw new Error('Event payload exceeds its limit')
    const existing = this.store.db.prepare('SELECT id,payload FROM accepted_events WHERE pod_id=? AND source=? AND dedupe_key=?').get(podId, source, key)
    if (existing) {
      if (existing.payload !== encoded) throw new Error('Event identity conflicts with an accepted payload')
      return existing.id as string
    }
    const count = this.store.db.prepare('SELECT count(*) AS total,sum(pod_id=?) AS pod FROM accepted_events WHERE state!=\'processed\'').get(podId)!
    if ((count.total as number) >= 10000 || (count.pod as number) >= 1000) throw new Error('Event queue is full; retry after processing or recovery')
    const id = randomUUID()
    this.store.db.prepare('INSERT INTO accepted_events(id,pod_id,source,dedupe_key,payload,accepted_at) VALUES(?,?,?,?,?,?)').run(id, podId, source, key, encoded, this.now())
    return id
  }

  requestManual(podId: string): void {
    if (this.store.db.prepare('SELECT 1 FROM run_leases WHERE pod_id=?').get(podId)) return
    if (!this.store.db.prepare('SELECT 1 FROM accepted_events WHERE pod_id=? AND source=\'manual\' AND state=\'pending\'').get(podId)) this.acceptEvent(podId, 'manual', randomUUID(), {})
    this.drain()
  }

  tick(): void {
    const due = this.store.db.prepare('SELECT s.* FROM schedules s JOIN pods p ON p.id=s.pod_id WHERE s.enabled=1 AND p.lifecycle=\'active\' AND s.next_at<=? ORDER BY s.next_at,s.pod_id').all(this.now())
    for (const row of due) {
      try {
        this.store.transaction(() => {
          if (!this.store.db.prepare('SELECT 1 FROM accepted_events WHERE pod_id=? AND source=\'schedule\' AND state=\'pending\'').get(row.pod_id as string)) this.acceptEvent(row.pod_id as string, 'schedule', `${row.revision}:${row.next_at}`, { dueAt: row.next_at })
          this.store.db.prepare('UPDATE schedules SET next_at=?,error=NULL WHERE pod_id=?').run(nextDue(parseSchedule(JSON.parse(row.spec as string)), row.next_at as number, this.now()), row.pod_id as string)
        })
      }
      catch (error) { this.store.db.prepare('UPDATE schedules SET error=? WHERE pod_id=?').run(error instanceof Error ? error.message : 'Schedule intake failed', row.pod_id as string) }
    }
    this.drain()
  }

  drain(): void {
    const available = () => (this.store.db.prepare('SELECT count(*) AS count FROM run_leases').get()!.count as number) < (this.store.db.prepare('SELECT concurrency FROM settings WHERE id=1').get()!.concurrency as number)
    const ready = this.store.db.prepare('SELECT e.pod_id,min(e.sequence) AS first FROM accepted_events e JOIN pods p ON p.id=e.pod_id WHERE e.state=\'pending\' AND p.lifecycle!=\'archived\' AND (p.lifecycle=\'active\' OR e.source=\'manual\') AND NOT EXISTS(SELECT 1 FROM run_leases l WHERE l.pod_id=e.pod_id) AND NOT EXISTS(SELECT 1 FROM accepted_events b WHERE b.pod_id=e.pod_id AND b.state IN (\'blocked\',\'claimed\')) GROUP BY e.pod_id ORDER BY first').all()
    for (const row of ready) {
      if (!available()) break
      const podId = row.pod_id as string; const pod = this.store.getPod(podId)
      const events = this.store.db.prepare('SELECT id,source FROM accepted_events WHERE pod_id=? AND state=\'pending\' AND (?=\'active\' OR source=\'manual\') ORDER BY sequence LIMIT 50').all(podId, pod.lifecycle)
      const reason = events.some(event => event.source === 'manual') ? 'manual' : events.every(event => event.source === 'schedule') ? 'schedule' : 'event'
      try { this.driver.start(podId, { reason, eventIds: events.map(event => event.id as string) }) }
      catch (error) {
        const message = error instanceof Error ? error.message : 'Queued run could not start'
        this.store.transaction(() => { for (const event of events) this.store.db.prepare('UPDATE accepted_events SET state=\'blocked\',error=? WHERE id=? AND state=\'pending\'').run(message, event.id as string) })
      }
    }
  }
}
