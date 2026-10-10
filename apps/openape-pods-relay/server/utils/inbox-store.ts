import { createHash, randomUUID } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { ProtocolError } from '@openape/pods-protocol'
import type { Owner } from '@openape/pods-protocol'
import type { InboxDecision } from '../../../openape-pods/src/contracts/inbox'
import type { InboxDecisionData, InboxDevice, InboxItem, InboxPublication, InboxSubscription, OutboxEntry } from '../../shared/inbox-types'

// Push services that browsers hand out today; anything else is refused before the server ever connects to it.
const pushHosts = [/^web\.push\.apple\.com$/, /^fcm\.googleapis\.com$/, /^updates\.push\.services\.mozilla\.com$/, /\.notify\.windows\.com$/]
// Sign-in may resume only a same-origin inbox page.
export const inboxPath = /^\/inbox\/(?:[\w-]+(?:\/[\w-]+)*\/?)?(?:\?[\w=&-]{1,200})?$/

export function parseSubscription(input: unknown): InboxSubscription {
  const value = input as { endpoint?: unknown, keys?: { p256dh?: unknown, auth?: unknown } } | null
  const endpoint = typeof value?.endpoint === 'string' && value.endpoint.length <= 2048 ? URL.parse(value.endpoint) : null
  const p256dh = value?.keys?.p256dh
  const auth = value?.keys?.auth
  if (!endpoint || endpoint.protocol !== 'https:' || endpoint.port || !pushHosts.some(host => host.test(endpoint.hostname))) throw new ProtocolError('invalid_push_endpoint')
  if (typeof p256dh !== 'string' || !/^[\w-]{80,100}$/.test(p256dh) || typeof auth !== 'string' || !/^[\w-]{16,32}$/.test(auth)) throw new ProtocolError('invalid_push_keys')
  return { endpoint: endpoint.href, p256dh, auth }
}

// `idpPushDelayMs`: an IdP approval is often granted at once by the owner's own session (issue 1455); its push
// waits this long, and a decision that resolves meanwhile drops the pending push without notifying.
export const inboxLimits = { bodyBytes: 64 * 1024, retentionMs: 90 * 86400000, tombstoneMs: 30 * 86400000, itemsPerOwner: 10000, page: 50, pushAgeMs: 86400000, idpPushDelayMs: 60000 }
const key = (owner: Owner) => JSON.stringify([owner.issuer, owner.subject])
const id = /^[0-9a-f-]{36}$/
const eventKey = /^[\w.:-]{1,200}$/

// The service reads this content by design (approved trust model); it is never described as end-to-end encrypted.
export function parsePublication(input: unknown): InboxPublication {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new ProtocolError('invalid_inbox_item')
  const value = input as Record<string, unknown>
  for (const field of Object.keys(value)) {
    if (!['eventId', 'kind', 'title', 'body', 'podId', 'podName', 'runId', 'links'].includes(field)) throw new ProtocolError('invalid_inbox_item')
  }
  const text = (field: string, maximum: number, required = true): string | null => {
    const raw = value[field]
    if (raw === undefined && !required) return null
    if (typeof raw !== 'string' || !raw.trim()) throw new ProtocolError('invalid_inbox_item')
    if (Buffer.byteLength(raw) > maximum) throw new ProtocolError('inbox_item_too_large', 413)
    return raw
  }
  if (typeof value.eventId !== 'string' || !eventKey.test(value.eventId)) throw new ProtocolError('invalid_inbox_item')
  if (value.kind !== 'message') throw new ProtocolError('invalid_inbox_item')
  const links = value.links === undefined ? [] : value.links
  if (!Array.isArray(links) || links.length > 5) throw new ProtocolError('invalid_inbox_item')
  const parsedLinks = links.map((link) => {
    const entry = link as { title?: unknown, url?: unknown } | null
    const url = typeof entry?.url === 'string' && entry.url.length <= 2048 ? URL.parse(entry.url) : null
    if (!url || url.protocol !== 'https:' || url.username || url.password || typeof entry?.title !== 'string' || !entry.title.trim() || entry.title.length > 200) throw new ProtocolError('invalid_inbox_link')
    return { title: entry.title, url: url.href }
  })
  const podId = value.podId === undefined ? null : value.podId
  const runId = value.runId === undefined ? null : value.runId
  if ((podId !== null && (typeof podId !== 'string' || !id.test(podId))) || (runId !== null && (typeof runId !== 'string' || !id.test(runId)))) throw new ProtocolError('invalid_inbox_item')
  return { eventId: value.eventId, kind: 'message', title: text('title', 300) as string, body: text('body', inboxLimits.bodyBytes) as string, podId, podName: text('podName', 200, false), runId, links: parsedLinks }
}

export class InboxStore {
  readonly db: DatabaseSync
  constructor(path: string, readonly now = Date.now) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
    this.db = new DatabaseSync(path)
    const version = Number(this.db.prepare('PRAGMA user_version').get()?.user_version)
    if (version > 1) { this.db.close(); throw new Error('Inbox database requires a newer server') }
    // Additive only, so an older server can still open this database after a rollback.
    this.db.exec(`PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY,value INTEGER NOT NULL);
      INSERT OR IGNORE INTO meta(key,value) VALUES('sequence',0);
      CREATE TABLE IF NOT EXISTS devices(id TEXT PRIMARY KEY,owner TEXT NOT NULL,agent TEXT NOT NULL,created INTEGER NOT NULL,seen INTEGER NOT NULL,revoked INTEGER);
      CREATE TABLE IF NOT EXISTS subscriptions(endpoint TEXT PRIMARY KEY,device_id TEXT NOT NULL REFERENCES devices(id),owner TEXT NOT NULL,p256dh TEXT NOT NULL,auth TEXT NOT NULL,created INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS items(position INTEGER PRIMARY KEY AUTOINCREMENT,id TEXT NOT NULL UNIQUE,owner TEXT NOT NULL,runtime_id TEXT NOT NULL,event_id TEXT NOT NULL,digest TEXT NOT NULL,kind TEXT NOT NULL,state TEXT NOT NULL,title TEXT NOT NULL,body TEXT NOT NULL,pod_id TEXT,pod_name TEXT,run_id TEXT,links TEXT NOT NULL,created INTEGER NOT NULL,sequence INTEGER NOT NULL,read INTEGER,archived INTEGER,deleted INTEGER,UNIQUE(owner,runtime_id,event_id));
      CREATE TABLE IF NOT EXISTS outbox(id TEXT PRIMARY KEY,owner TEXT NOT NULL,item_id TEXT NOT NULL REFERENCES items(id),created INTEGER NOT NULL,state TEXT NOT NULL,attempts INTEGER NOT NULL DEFAULT 0,next INTEGER NOT NULL,result TEXT);
      CREATE INDEX IF NOT EXISTS owner_items ON items(owner,position);
      CREATE INDEX IF NOT EXISTS owner_changes ON items(owner,sequence);
      CREATE INDEX IF NOT EXISTS due_outbox ON outbox(state,next);
      PRAGMA user_version=1;`)
    // Added for decisions (M2); an older server ignores the column, so the version stays 1.
    if (!this.db.prepare('PRAGMA table_info(items)').all().some(column => column.name === 'decision')) this.db.exec('ALTER TABLE items ADD COLUMN decision TEXT')
  }

  close(): void { this.db.close() }
  private transaction<T>(run: () => T): T {
    this.db.exec('BEGIN IMMEDIATE')
    try { const result = run(); this.db.exec('COMMIT'); return result }
    catch (error) { this.db.exec('ROLLBACK'); throw error }
  }

  private nextSequence(): number { return Number(this.db.prepare('UPDATE meta SET value=value+1 WHERE key=\'sequence\' RETURNING value').get()?.value) }

  registerDevice(owner: Owner, agent: string): InboxDevice {
    const device = { id: randomUUID(), agent: agent.slice(0, 300), created: this.now(), seen: this.now() }
    this.db.prepare('INSERT INTO devices(id,owner,agent,created,seen) VALUES(?,?,?,?,?)').run(device.id, key(owner), device.agent, device.created, device.seen)
    return device
  }

  // Returns the active device and records its last use; a revoked or foreign device is absent.
  activeDevice(owner: Owner, deviceId: string): InboxDevice | null {
    const found = this.db.prepare('SELECT id,agent,created,seen FROM devices WHERE id=? AND owner=? AND revoked IS NULL').get(deviceId, key(owner))
    if (!found) return null
    this.db.prepare('UPDATE devices SET seen=? WHERE id=?').run(this.now(), deviceId)
    return { ...found } as unknown as InboxDevice
  }

  devices(owner: Owner): InboxDevice[] {
    return this.db.prepare('SELECT d.id,d.agent,d.created,d.seen,count(s.endpoint) AS push FROM devices d LEFT JOIN subscriptions s ON s.device_id=d.id WHERE d.owner=? AND d.revoked IS NULL GROUP BY d.id ORDER BY d.seen DESC').all(key(owner)).map(row => ({ ...row, push: Number(row.push) > 0 }) as unknown as InboxDevice)
  }

  revokeDevice(owner: Owner, deviceId: string): void {
    this.transaction(() => {
      const revoked = this.db.prepare('UPDATE devices SET revoked=? WHERE id=? AND owner=? AND revoked IS NULL').run(this.now(), deviceId, key(owner))
      if (Number(revoked.changes) === 0) throw new ProtocolError('not_found', 404)
      this.db.prepare('DELETE FROM subscriptions WHERE device_id=?').run(deviceId)
    })
  }

  // An endpoint stays with the device that registered it; another account must first unsubscribe it.
  subscribe(owner: Owner, deviceId: string, subscription: InboxSubscription): void {
    const updated = this.db.prepare('INSERT INTO subscriptions(endpoint,device_id,owner,p256dh,auth,created) VALUES(?,?,?,?,?,?) ON CONFLICT(endpoint) DO UPDATE SET device_id=excluded.device_id,p256dh=excluded.p256dh,auth=excluded.auth WHERE subscriptions.owner=excluded.owner')
      .run(subscription.endpoint, deviceId, key(owner), subscription.p256dh, subscription.auth, this.now())
    if (Number(updated.changes) === 0) throw new ProtocolError('push_endpoint_taken', 409)
  }

  unsubscribe(owner: Owner, deviceId: string): void { this.db.prepare('DELETE FROM subscriptions WHERE owner=? AND device_id=?').run(key(owner), deviceId) }
  forgetEndpoint(endpoint: string): void { this.db.prepare('DELETE FROM subscriptions WHERE endpoint=?').run(endpoint) }
  subscriptions(ownerKey: string): InboxSubscription[] {
    return this.db.prepare('SELECT endpoint,p256dh,auth FROM subscriptions WHERE owner=?').all(ownerKey) as unknown as InboxSubscription[]
  }

  // Idempotent per (owner, runtime, eventId): an identical retry returns the stored receipt, changed content conflicts.
  // The item and its push-outbox entry commit together, so a push never points at a missing item.
  publish(owner: Owner, runtimeId: string, publication: InboxPublication): { id: string, created: boolean } {
    const digest = createHash('sha256').update(JSON.stringify(publication)).digest('hex')
    return this.transaction(() => {
      const existing = this.db.prepare('SELECT id,digest FROM items WHERE owner=? AND runtime_id=? AND event_id=?').get(key(owner), runtimeId, publication.eventId) as { id: string, digest: string } | undefined
      if (existing) {
        if (existing.digest !== digest) throw new ProtocolError('inbox_event_conflict', 409)
        return { id: existing.id, created: false }
      }
      const count = Number(this.db.prepare('SELECT count(*) AS n FROM items WHERE owner=? AND deleted IS NULL').get(key(owner))?.n)
      if (count >= inboxLimits.itemsPerOwner) throw new ProtocolError('inbox_quota', 507)
      const itemId = randomUUID()
      this.db.prepare('INSERT INTO items(id,owner,runtime_id,event_id,digest,kind,state,title,body,pod_id,pod_name,run_id,links,created,sequence) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
        .run(itemId, key(owner), runtimeId, publication.eventId, digest, publication.kind, 'open', publication.title, publication.body, publication.podId, publication.podName, publication.runId, JSON.stringify(publication.links), this.now(), this.nextSequence())
      this.db.prepare('INSERT INTO outbox(id,owner,item_id,created,state,next) VALUES(?,?,?,?,?,?)').run(randomUUID(), key(owner), itemId, this.now(), 'pending', this.now())
      return { id: itemId, created: true }
    })
  }

  // The desktop publishes its complete set: new decisions get a push, changed ones update in place,
  // vanished ones resolve and stay readable. A decision the owner deleted keeps its tombstone until it resolves,
  // so it is not brought back. A full inbox skips new decisions but still resolves vanished ones.
  syncDecisions(owner: Owner, runtimeId: string, decisions: InboxDecision[]): { created: number, updated: number, resolved: number, skipped: number } {
    return this.transaction(() => {
      const counts = { created: 0, updated: 0, resolved: 0, skipped: 0 }
      const select = this.db.prepare('SELECT id,digest,state,deleted FROM items WHERE owner=? AND runtime_id=? AND event_id=? AND kind=\'decision\'')
      for (const decision of decisions) {
        const data: InboxDecisionData = { sourceId: decision.sourceId, digest: decision.digest, type: decision.type, authority: decision.authority, options: decision.options, runtimeId }
        const links = JSON.stringify(decision.link ? [decision.link] : [])
        const existing = select.get(key(owner), runtimeId, decision.sourceId) as { id: string, digest: string, state: string, deleted: number | null } | undefined
        if (existing?.deleted) continue
        if (existing) {
          if (existing.digest === decision.digest && existing.state === 'open') continue
          this.db.prepare('UPDATE items SET digest=?,state=\'open\',title=?,body=?,pod_id=?,pod_name=?,links=?,decision=?,sequence=? WHERE id=?')
            .run(decision.digest, decision.title, decision.body, decision.podId, decision.podName, links, JSON.stringify(data), this.nextSequence(), existing.id)
          counts.updated++
          continue
        }
        const count = Number(this.db.prepare('SELECT count(*) AS n FROM items WHERE owner=? AND deleted IS NULL').get(key(owner))?.n)
        if (count >= inboxLimits.itemsPerOwner) { counts.skipped++; continue }
        const itemId = randomUUID()
        this.db.prepare('INSERT INTO items(id,owner,runtime_id,event_id,digest,kind,state,title,body,pod_id,pod_name,run_id,links,created,sequence,decision) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
          .run(itemId, key(owner), runtimeId, decision.sourceId, decision.digest, 'decision', 'open', decision.title, decision.body, decision.podId, decision.podName, null, links, this.now(), this.nextSequence(), JSON.stringify(data))
        const due = this.now() + (decision.authority === 'idp' ? inboxLimits.idpPushDelayMs : 0)
        this.db.prepare('INSERT INTO outbox(id,owner,item_id,created,state,next) VALUES(?,?,?,?,?,?)').run(randomUUID(), key(owner), itemId, this.now(), 'pending', due)
        counts.created++
      }
      const current = new Set(decisions.map(decision => decision.sourceId))
      const open = this.db.prepare('SELECT id,event_id FROM items WHERE owner=? AND runtime_id=? AND kind=\'decision\' AND state=\'open\'').all(key(owner), runtimeId) as { id: string, event_id: string }[]
      for (const row of open.filter(row => !current.has(row.event_id))) {
        this.db.prepare('UPDATE items SET state=\'resolved\',sequence=? WHERE id=?').run(this.nextSequence(), row.id)
        this.db.prepare('DELETE FROM outbox WHERE item_id=? AND state=\'pending\'').run(row.id)
        counts.resolved++
      }
      return counts
    })
  }

  /** The stored, still open decision an owner acts on, with the digest the desktop must still match. */
  openDecision(owner: Owner, itemId: string): { item: InboxItem, digest: string } {
    const found = this.db.prepare('SELECT * FROM items WHERE id=? AND owner=? AND deleted IS NULL AND kind=\'decision\'').get(itemId, key(owner)) as Record<string, unknown> | undefined
    if (!found) throw new ProtocolError('not_found', 404)
    if (found.state !== 'open') throw new ProtocolError('decision_resolved', 409)
    return { item: item(found), digest: String(found.digest) }
  }

  list(owner: Owner, options: { kind?: string, archived?: boolean, before?: number } = {}): { items: InboxItem[], next: number | null } {
    const kind = options.kind === 'message' || options.kind === 'decision' ? options.kind : null
    const before = Number.isSafeInteger(options.before) && options.before! > 0 ? options.before! : Number.MAX_SAFE_INTEGER
    const rows = this.db.prepare(`SELECT * FROM items WHERE owner=? AND deleted IS NULL AND position<? AND (? IS NULL OR kind=?) AND archived IS ${options.archived ? 'NOT ' : ''}NULL ORDER BY position DESC LIMIT ?`)
      .all(key(owner), before, kind, kind, inboxLimits.page + 1) as Record<string, unknown>[]
    const page = rows.slice(0, inboxLimits.page)
    return { items: page.map(item), next: rows.length > inboxLimits.page ? Number(page.at(-1)!.position) : null }
  }

  // Everything that changed after a cursor, including tombstones, so a client cache never resurrects deleted items.
  changes(owner: Owner, after: number): { items: InboxItem[], cursor: number, more: boolean } {
    const rows = this.db.prepare('SELECT * FROM items WHERE owner=? AND sequence>? ORDER BY sequence LIMIT ?').all(key(owner), Math.max(0, after), inboxLimits.page + 1) as Record<string, unknown>[]
    const page = rows.slice(0, inboxLimits.page)
    return { items: page.map(item), cursor: page.length ? Number(page.at(-1)!.sequence) : Math.max(0, after), more: rows.length > inboxLimits.page }
  }

  item(owner: Owner, itemId: string): InboxItem {
    const found = this.db.prepare('SELECT * FROM items WHERE id=? AND owner=? AND deleted IS NULL').get(itemId, key(owner)) as Record<string, unknown> | undefined
    if (!found) throw new ProtocolError('not_found', 404)
    return item(found)
  }

  // Read, archive and delete are account-wide; each change advances the sync sequence once.
  mark(owner: Owner, itemId: string, change: { read?: boolean, archived?: boolean, deleted?: boolean }): InboxItem | null {
    return this.transaction(() => {
      this.item(owner, itemId)
      const at = this.now()
      if (change.deleted) {
        this.db.prepare('UPDATE items SET deleted=?,title=\'\',body=\'\',links=\'[]\',decision=NULL,sequence=? WHERE id=?').run(at, this.nextSequence(), itemId)
        this.db.prepare('DELETE FROM outbox WHERE item_id=? AND state=\'pending\'').run(itemId)
        return null
      }
      const set = (column: 'read' | 'archived', value: boolean | undefined) => value === undefined ? '' : `${column}=${value ? `coalesce(${column},${at})` : 'NULL'},`
      const assignments = set('read', change.read) + set('archived', change.archived)
      if (assignments) this.db.prepare(`UPDATE items SET ${assignments}sequence=? WHERE id=?`).run(this.nextSequence(), itemId)
      return this.item(owner, itemId)
    })
  }

  badgeCount(owner: Owner): number { return this.badge(key(owner)) }
  private badge(ownerKey: string): number {
    const row = this.db.prepare(`SELECT count(*) AS count FROM items
      WHERE owner=? AND deleted IS NULL AND archived IS NULL
      AND ((kind='decision' AND state='open') OR (kind='message' AND read IS NULL))`).get(ownerKey)
    return Number(row!.count)
  }

  /** What a due push announces, with the account's current badge; null once the item is gone or its decision resolved. */
  pushContent(entry: OutboxEntry): { item: InboxItem, badge: number } | null {
    const found = this.db.prepare('SELECT * FROM items WHERE id=? AND owner=? AND deleted IS NULL').get(entry.itemId, entry.owner) as Record<string, unknown> | undefined
    if (!found || (found.kind === 'decision' && found.state !== 'open')) return null
    return { item: item(found), badge: this.badge(entry.owner) }
  }

  claimOutbox(limit = 20): OutboxEntry[] {
    return this.db.prepare('SELECT id,owner,item_id AS itemId,attempts,created FROM outbox WHERE state=\'pending\' AND next<=? ORDER BY next LIMIT ?').all(this.now(), limit) as unknown as OutboxEntry[]
  }

  settleOutbox(entryId: string, outcome: { state: 'sent' | 'pending' | 'failed', next?: number, result: string }): void {
    this.db.prepare('UPDATE outbox SET state=?,attempts=attempts+1,next=?,result=? WHERE id=?').run(outcome.state, outcome.next ?? this.now(), outcome.result.slice(0, 500), entryId)
  }

  // Bounded retention: messages expire after 90 days, tombstones are purged 30 days later. Pending decisions stay.
  retain(): { expired: number, purged: number } {
    return this.transaction(() => {
      const cutoff = this.now() - inboxLimits.retentionMs
      const stale = this.db.prepare('SELECT id FROM items WHERE deleted IS NULL AND created<? AND (kind=\'message\' OR state!=\'open\')').all(cutoff) as { id: string }[]
      for (const { id: itemId } of stale) this.db.prepare('UPDATE items SET deleted=?,title=\'\',body=\'\',links=\'[]\',decision=NULL,sequence=? WHERE id=?').run(this.now(), this.nextSequence(), itemId)
      this.db.prepare('DELETE FROM outbox WHERE created<? OR item_id IN (SELECT id FROM items WHERE deleted IS NOT NULL)').run(this.now() - inboxLimits.pushAgeMs)
      const purged = this.db.prepare('DELETE FROM items WHERE deleted IS NOT NULL AND deleted<? AND NOT (kind=\'decision\' AND state=\'open\')').run(this.now() - inboxLimits.tombstoneMs)
      return { expired: stale.length, purged: Number(purged.changes) }
    })
  }
}

function item(row: Record<string, unknown>): InboxItem {
  return {
    id: String(row.id), kind: row.kind as InboxItem['kind'], state: String(row.state), decision: typeof row.decision === 'string' ? JSON.parse(row.decision) as InboxDecisionData : null, title: String(row.title), body: String(row.body),
    pod: row.pod_id ? { id: String(row.pod_id), name: row.pod_name === null ? null : String(row.pod_name) } : null, runId: row.run_id === null ? null : String(row.run_id),
    links: JSON.parse(String(row.links)) as InboxItem['links'], created: Number(row.created), sequence: Number(row.sequence),
    read: row.read === null ? null : Number(row.read), archived: row.archived === null ? null : Number(row.archived), deleted: row.deleted === null ? null : Number(row.deleted),
  }
}
