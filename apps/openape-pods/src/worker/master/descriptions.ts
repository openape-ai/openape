import type { PodDatabase } from '../storage/database'

import type { PodDescription } from '../../contracts/description'

export type DescriptionGenerator = (input: string, signal: AbortSignal) => Promise<string>
const segmentBytes = 48 * 1024

export class PodDescriptions {
  private active: Promise<void> | null = null
  private controller: AbortController | null = null
  constructor(private readonly store: PodDatabase, private readonly generate: DescriptionGenerator) {
    store.db.prepare('UPDATE pod_descriptions SET state=\'failed\',error=\'Description update was interrupted. Retry to continue.\' WHERE state=\'running\'').run()
  }

  view(podId: string): PodDescription | null {
    const row = this.store.db.prepare('SELECT * FROM pod_descriptions WHERE pod_id=?').get(podId)
    return row ? { text: row.body as string, state: row.state as PodDescription['state'], error: row.error as string | null, revision: row.revision as number, updatedAt: row.updated_at as number | null } : null
  }

  request(podId: string, refresh = false): void {
    this.store.getPod(podId)
    if (this.store.db.prepare('SELECT manual FROM pod_descriptions WHERE pod_id=?').get(podId)?.manual === 1) return
    const row = this.store.db.prepare('SELECT MAX(m.rowid) AS latest FROM master_messages m JOIN master_message_scopes s ON s.message_id=m.id WHERE s.scope=? AND NOT EXISTS(SELECT 1 FROM chat_message_context c WHERE c.message_id=m.id AND c.revision>1) AND m.role IN (\'user\',\'assistant\') AND m.state IN (\'sent\',\'completed\')').get(podId)
    if (!row?.latest) return
    const current = this.store.db.prepare('SELECT covered_row,state FROM pod_descriptions WHERE pod_id=?').get(podId)
    if (refresh && current?.state === 'ready') this.store.db.prepare('UPDATE pod_descriptions SET covered_row=0,work_row=0,work_offset=0,work_body=\'\' WHERE pod_id=?').run(podId)
    else if (current && Number(current.covered_row) >= Number(row.latest)) return
    this.store.db.prepare('INSERT INTO pod_descriptions(pod_id,requested_row) VALUES(?,?) ON CONFLICT(pod_id) DO UPDATE SET requested_row=excluded.requested_row,state=CASE WHEN state=\'running\' THEN state ELSE \'pending\' END,error=NULL').run(podId, row.latest)
  }

  start(): void {
    if (this.active) return
    this.controller = new AbortController()
    this.active = this.process(this.controller.signal).finally(() => { this.active = null; this.controller = null })
  }

  async idle(): Promise<void> { await this.active }
  async stop(): Promise<void> { this.controller?.abort(new Error('Description update stopped')); await this.active }

  private async process(signal: AbortSignal): Promise<void> {
    while (!signal.aborted) {
      const row = this.store.db.prepare('SELECT * FROM pod_descriptions WHERE state=\'pending\' ORDER BY rowid LIMIT 1').get()
      if (!row) return
      const podId = row.pod_id as string
      this.store.db.prepare('UPDATE pod_descriptions SET state=\'running\',error=NULL WHERE pod_id=?').run(podId)
      try { await this.update(podId, signal) }
      catch (error) { this.store.db.prepare('UPDATE pod_descriptions SET state=\'failed\',error=? WHERE pod_id=?').run(error instanceof Error ? error.message : 'Description generation failed', podId) }
    }
  }

  private async update(podId: string, signal: AbortSignal): Promise<void> {
    const row = this.store.db.prepare('SELECT * FROM pod_descriptions WHERE pod_id=?').get(podId)!
    const messages = this.store.db.prepare('SELECT m.rowid AS sequence,m.role,m.body FROM master_messages m JOIN master_message_scopes s ON s.message_id=m.id WHERE s.scope=? AND NOT EXISTS(SELECT 1 FROM chat_message_context c WHERE c.message_id=m.id AND c.revision>1) AND (m.rowid>? OR (m.rowid=? AND ?>0)) AND m.rowid<=? AND m.role IN (\'user\',\'assistant\') AND m.state IN (\'sent\',\'completed\') ORDER BY m.rowid LIMIT 100').all(podId, row.work_row, row.work_row, row.work_offset, row.requested_row)
    let bytes = 0; const segment: { role: string, text: string, continuation: boolean }[] = []; let covered = row.work_row as number; let offset = row.work_offset as number
    for (const message of messages) {
      const start = message.sequence === row.work_row ? offset : 0
      const remaining = (message.body as string).slice(start)
      const partial = Buffer.byteLength(remaining) > segmentBytes
      let text = partial ? remaining.slice(0, 12000) : remaining
      if (partial && /[\uD800-\uDBFF]$/.test(text)) text = text.slice(0, -1)
      const size = Buffer.byteLength(text)
      if (bytes + size > segmentBytes) break
      segment.push({ role: message.role as string, text, continuation: start > 0 }); bytes += size; covered = message.sequence as number; offset = partial ? start + text.length : 0
      if (partial) break
    }
    if (!segment.length) throw new Error('No completed conversation messages are available for the description')
    const pod = this.store.getPod(podId)
    const schedule = this.store.db.prepare('SELECT spec,enabled FROM schedules WHERE pod_id=?').get(podId)
    const configuration = { name: pod.name, lifecycle: pod.lifecycle, scriptActivated: !!pod.activeScript, schedule: schedule ? { spec: JSON.parse(schedule.spec as string) as unknown, enabled: schedule.enabled === 1 } : null }
    const text = await this.generate(JSON.stringify({ previousDescription: row.work_body || row.body, conversation: segment, configuration }), signal)
    signal.throwIfAborted()
    if (!text.trim() || text.length > 4000) throw new Error('Generated description must contain 1–4000 characters')
    this.store.transaction(() => {
      const current = this.store.db.prepare('SELECT requested_row,manual FROM pod_descriptions WHERE pod_id=?').get(podId)
      if (!current || current.manual === 1) return
      if (current.requested_row !== row.requested_row) { this.store.db.prepare('UPDATE pod_descriptions SET state=\'pending\' WHERE pod_id=?').run(podId); return }
      const finished = covered === row.requested_row && offset === 0
      this.store.db.prepare('UPDATE pod_descriptions SET work_body=?,work_row=?,work_offset=?,state=? WHERE pod_id=?').run(text, covered, offset, finished ? 'ready' : 'pending', podId)
      if (finished) this.store.db.prepare('UPDATE pod_descriptions SET body=?,covered_row=?,revision=revision+1,updated_at=? WHERE pod_id=?').run(text, covered, Date.now(), podId)
    })
  }
}
