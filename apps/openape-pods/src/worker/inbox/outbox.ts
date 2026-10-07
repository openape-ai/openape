import { createHash } from 'node:crypto'
import type { PodDatabase } from '../storage/database'

// Durable queue for owner notifications from Pod scripts (plan M3, issue 1446). The worker only queues;
// the desktop main process delivers to the account inbox with its signed runtime session.

export interface Notify { key: string, title: string, body: string, links: { title: string, url: string }[] }
export interface InboxPublication { eventId: string, kind: 'message', title: string, body: string, podId: string, podName: string, runId: string, links: Notify['links'] }
export type InboxOutboxCommand = { type: 'due' } | { type: 'settle', eventId: string, outcome: { state: 'delivered', itemId: string } | { state: 'refused', reason: string } | { state: 'retry', reason: string } } | { type: 'status' }

// Same bounds as the relay, so a script learns about an invalid message while it runs, not later in delivery.
export function parseNotify(payload: unknown): Notify {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('notify expects { key, title, body, links? }')
  const value = payload as Record<string, unknown>
  if (Object.keys(value).some(field => !['key', 'title', 'body', 'links'].includes(field))) throw new Error('notify accepts only key, title, body and links; the recipient is always the Pod owner')
  if (typeof value.key !== 'string' || !/^[\w.-]{1,120}$/.test(value.key)) throw new Error('notify key must be 1–120 letters, digits, dots, dashes or underscores and stable for this message')
  if (typeof value.title !== 'string' || !value.title.trim() || value.title.length > 300) throw new Error('notify title must be 1–300 characters')
  if (typeof value.body !== 'string' || !value.body.trim() || Buffer.byteLength(value.body) > 64 * 1024) throw new Error('notify body must be non-empty and at most 64 KiB')
  const links = value.links === undefined ? [] : value.links
  if (!Array.isArray(links) || links.length > 5) throw new Error('notify accepts at most five links')
  return {
    key: value.key, title: value.title, body: value.body,
    links: links.map((link) => {
      const entry = link as { title?: unknown, url?: unknown } | null
      const url = typeof entry?.url === 'string' && entry.url.length <= 2048 ? URL.parse(entry.url) : null
      if (!url || url.protocol !== 'https:' || url.username || url.password || typeof entry?.title !== 'string' || !entry.title.trim() || entry.title.length > 200) throw new Error('notify links need a title and an https URL')
      return { title: entry.title, url: url.href }
    }),
  }
}

export class InboxOutbox {
  constructor(private readonly store: PodDatabase, private readonly now = Date.now) {}

  // A repeated key with the same content (for example from a retried run) is not queued twice; changed content is refused.
  queue(pod: { id: string, name: string }, runId: string, notify: Notify): { eventId: string, queued: boolean } {
    const eventId = `${pod.id}:${notify.key}`
    const digest = createHash('sha256').update(JSON.stringify([notify.title, notify.body, notify.links])).digest('hex')
    return this.store.transaction(() => {
      const existing = this.store.db.prepare('SELECT digest FROM inbox_outbox WHERE event_id=?').get(eventId) as { digest: string } | undefined
      if (existing) {
        if (existing.digest !== digest) throw new Error(`notify key "${notify.key}" was already used with different content`)
        return { eventId, queued: false }
      }
      const publication: InboxPublication = { eventId, kind: 'message', title: notify.title, body: notify.body, podId: pod.id, podName: pod.name.slice(0, 200), runId, links: notify.links }
      this.store.db.prepare('INSERT INTO inbox_outbox(event_id,pod_id,run_id,digest,publication,state,next_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)')
        .run(eventId, pod.id, runId, digest, JSON.stringify(publication), 'pending', this.now(), this.now(), this.now())
      return { eventId, queued: true }
    })
  }

  execute(command: InboxOutboxCommand): unknown {
    if (command.type === 'due') return this.due()
    if (command.type === 'status') return this.status()
    return this.settle(command.eventId, command.outcome)
  }

  private due(): InboxPublication[] {
    const rows = this.store.db.prepare('SELECT publication FROM inbox_outbox WHERE state=\'pending\' AND next_at<=? ORDER BY next_at LIMIT 20').all(this.now()) as { publication: string }[]
    return rows.map(row => JSON.parse(row.publication) as InboxPublication)
  }

  // Unknown transport outcomes stay pending and are retried with the identical event: the inbox deduplicates it.
  private settle(eventId: string, outcome: Extract<InboxOutboxCommand, { type: 'settle' }>['outcome']): { state: string } {
    const row = this.store.db.prepare('SELECT attempts FROM inbox_outbox WHERE event_id=?').get(eventId) as { attempts: number } | undefined
    if (!row) throw new Error('Unknown inbox notification')
    const backoff = Math.min(3600000, 30000 * 2 ** Math.min(row.attempts, 7))
    const [state, result, next] = outcome.state === 'delivered' ? ['delivered', outcome.itemId, this.now()] : outcome.state === 'refused' ? ['refused', outcome.reason, this.now()] : ['pending', outcome.reason, this.now() + backoff]
    this.store.db.prepare('UPDATE inbox_outbox SET state=?,result=?,attempts=attempts+1,next_at=?,updated_at=? WHERE event_id=? AND state=\'pending\'').run(state, String(result).slice(0, 500), next, this.now(), eventId)
    return { state }
  }

  private status(): { pending: number, refused: { eventId: string, reason: string }[] } {
    const pending = Number(this.store.db.prepare('SELECT count(*) AS n FROM inbox_outbox WHERE state=\'pending\'').get()?.n)
    const refused = this.store.db.prepare('SELECT event_id AS eventId, result AS reason FROM inbox_outbox WHERE state=\'refused\' ORDER BY updated_at DESC LIMIT 20').all() as { eventId: string, reason: string }[]
    return { pending, refused }
  }
}

export function parseInboxOutboxCommand(value: unknown): InboxOutboxCommand {
  const command = value as Record<string, unknown> | null
  if (command?.type === 'due' || command?.type === 'status') return { type: command.type }
  const outcome = command?.outcome as Record<string, unknown> | undefined
  if (command?.type === 'settle' && typeof command.eventId === 'string' && outcome && ['delivered', 'refused', 'retry'].includes(outcome.state as string)) {
    if (outcome.state === 'delivered' && typeof outcome.itemId === 'string') return { type: 'settle', eventId: command.eventId, outcome: { state: 'delivered', itemId: outcome.itemId } }
    if (outcome.state !== 'delivered' && typeof outcome.reason === 'string') return { type: 'settle', eventId: command.eventId, outcome: { state: outcome.state as 'refused' | 'retry', reason: outcome.reason } }
  }
  throw new Error('Invalid inbox outbox command')
}
