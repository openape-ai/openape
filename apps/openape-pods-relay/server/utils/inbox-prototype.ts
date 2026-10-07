// ponytail: disposable M0 prototype (issue 1446). Separate database so removal is one file; M1 replaces it with the durable inbox.
import { randomBytes, randomUUID } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { ProtocolError } from '@openape/pods-protocol'
import type { Owner } from '@openape/pods-protocol'
import { inboxPath, parseSubscription } from './inbox-store'
import type { InboxSubscription } from './inbox-types'

export { inboxPath, parseSubscription }

const maxPending = 100
const key = (owner: Owner) => JSON.stringify([owner.issuer, owner.subject])

export interface InboxItem { id: string, kind: 'decision' | 'message', title: string, body: string, choices: string[], outcome: string | null, created: number, decided: number | null, read: number | null }
export interface PushRecord { id: string, itemId: string | null, scheduled: number, sent: number | null, status: number | null, error: string | null, shown: number | null, clicked: number | null, opened: number | null }

export class InboxPrototype {
  readonly db: DatabaseSync
  constructor(path: string, readonly now = Date.now) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
    this.db = new DatabaseSync(path)
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS items(id TEXT PRIMARY KEY,owner TEXT NOT NULL,kind TEXT NOT NULL,title TEXT NOT NULL,body TEXT NOT NULL,choices TEXT NOT NULL,outcome TEXT,created INTEGER NOT NULL,decided INTEGER,read INTEGER);
      CREATE TABLE IF NOT EXISTS subscriptions(endpoint TEXT PRIMARY KEY,owner TEXT NOT NULL,p256dh TEXT NOT NULL,auth TEXT NOT NULL,agent TEXT NOT NULL,created INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS pushes(id TEXT PRIMARY KEY,owner TEXT NOT NULL,token TEXT NOT NULL UNIQUE,item_id TEXT,scheduled INTEGER NOT NULL,sent INTEGER,status INTEGER,error TEXT,shown INTEGER,clicked INTEGER,opened INTEGER);
      CREATE INDEX IF NOT EXISTS due_pushes ON pushes(sent,scheduled);`)
  }

  close(): void { this.db.close() }

  // An endpoint stays with the account that registered it; a device moves accounts only after that account unsubscribes.
  subscribe(owner: Owner, subscription: InboxSubscription, agent: string): void {
    const updated = this.db.prepare('INSERT INTO subscriptions(endpoint,owner,p256dh,auth,agent,created) VALUES(?,?,?,?,?,?) ON CONFLICT(endpoint) DO UPDATE SET p256dh=excluded.p256dh,auth=excluded.auth,agent=excluded.agent WHERE subscriptions.owner=excluded.owner')
      .run(subscription.endpoint, key(owner), subscription.p256dh, subscription.auth, agent.slice(0, 300), this.now())
    if (Number(updated.changes) === 0) throw new ProtocolError('push_endpoint_taken', 409)
  }

  unsubscribe(owner: Owner, endpoint: string): void { this.db.prepare('DELETE FROM subscriptions WHERE endpoint=? AND owner=?').run(endpoint, key(owner)) }
  forget(endpoint: string): void { this.db.prepare('DELETE FROM subscriptions WHERE endpoint=?').run(endpoint) }
  subscriptions(ownerKey: string): InboxSubscription[] {
    return this.db.prepare('SELECT endpoint,p256dh,auth FROM subscriptions WHERE owner=?').all(ownerKey) as unknown as InboxSubscription[]
  }

  devices(owner: Owner): number { return Number(this.db.prepare('SELECT count(*) AS n FROM subscriptions WHERE owner=?').get(key(owner))?.n) }

  schedule(owner: Owner, times: number[]): PushRecord[] {
    const now = this.now()
    if (!Array.isArray(times) || times.length < 1 || times.length > 30 || times.some(at => !Number.isSafeInteger(at) || at < now - 60000 || at > now + 3 * 86400000)) throw new ProtocolError('invalid_schedule')
    const pending = Number(this.db.prepare('SELECT count(*) AS n FROM pushes WHERE owner=? AND sent IS NULL').get(key(owner))?.n)
    if (pending + times.length > maxPending) throw new ProtocolError('schedule_full', 409)
    const insert = this.db.prepare('INSERT INTO pushes(id,owner,token,scheduled) VALUES(?,?,?,?)')
    for (const at of times) insert.run(randomUUID(), key(owner), randomBytes(24).toString('base64url'), Math.max(at, now))
    return this.pushes(owner)
  }

  cancelPending(owner: Owner): void { this.db.prepare('DELETE FROM pushes WHERE owner=? AND sent IS NULL').run(key(owner)) }

  // Claims due pushes and persists their inbox item before anything is dispatched; a claimed push is never sent twice.
  claimDue(): { push: PushRecord & { token: string }, ownerKey: string, item: InboxItem }[] {
    const rows = this.db.prepare('SELECT id,owner,token FROM pushes WHERE sent IS NULL AND scheduled<=? ORDER BY scheduled LIMIT 20').all(this.now()) as { id: string, owner: string, token: string }[]
    return rows.map((row) => {
      const sequence = Number(this.db.prepare('SELECT count(*) AS n FROM items WHERE owner=?').get(row.owner)?.n) + 1
      const item: InboxItem = sequence % 2
        ? { id: randomUUID(), kind: 'decision', title: `Testentscheidung ${sequence}`, body: `Synthetischer Beleg ${sequence} wartet. Ablegen oder verwerfen? Keine echte Pod-Aktion.`, choices: ['Ablegen', 'Verwerfen'], outcome: null, created: this.now(), decided: null, read: null }
        : { id: randomUUID(), kind: 'message', title: `Testmitteilung ${sequence}`, body: `Kontrollierter Push ${sequence} aus dem M0-Prototyp, erzeugt ${new Date(this.now()).toISOString()}.`, choices: [], outcome: null, created: this.now(), decided: null, read: null }
      this.db.exec('BEGIN IMMEDIATE')
      try {
        this.db.prepare('INSERT INTO items(id,owner,kind,title,body,choices,created) VALUES(?,?,?,?,?,?,?)').run(item.id, row.owner, item.kind, item.title, item.body, JSON.stringify(item.choices), item.created)
        this.db.prepare('UPDATE pushes SET item_id=?,sent=? WHERE id=?').run(item.id, this.now(), row.id)
        this.db.exec('COMMIT')
      }
      catch (error) { this.db.exec('ROLLBACK'); throw error }
      return { push: { ...this.push(row.id)!, token: row.token }, ownerKey: row.owner, item }
    })
  }

  recordSend(pushId: string, status: number | null, error: string | null): void {
    this.db.prepare('UPDATE pushes SET status=?,error=? WHERE id=?').run(status, error?.slice(0, 500) ?? null, pushId)
  }

  receipt(token: string, phase: 'shown' | 'clicked'): boolean {
    if (typeof token !== 'string' || token.length > 64) return false
    return Number(this.db.prepare(`UPDATE pushes SET ${phase}=coalesce(${phase},?) WHERE token=?`).run(this.now(), token).changes) > 0
  }

  opened(owner: Owner, pushId: string, itemId: string): void {
    this.db.prepare('UPDATE pushes SET opened=coalesce(opened,?) WHERE id=? AND owner=? AND item_id=?').run(this.now(), pushId, key(owner), itemId)
  }

  items(owner: Owner): InboxItem[] {
    return (this.db.prepare('SELECT * FROM items WHERE owner=? ORDER BY created DESC LIMIT 200').all(key(owner)) as Record<string, unknown>[]).map(row)
  }

  item(owner: Owner, id: string): InboxItem {
    const found = this.db.prepare('SELECT * FROM items WHERE id=? AND owner=?').get(id, key(owner)) as Record<string, unknown> | undefined
    if (!found) throw new ProtocolError('not_found', 404)
    return row(found)
  }

  markRead(owner: Owner, id: string): InboxItem {
    this.db.prepare('UPDATE items SET read=coalesce(read,?) WHERE id=? AND owner=?').run(this.now(), id, key(owner))
    return this.item(owner, id)
  }

  // The first valid choice wins; a later or concurrent choice returns the recorded outcome instead of replacing it.
  decide(owner: Owner, id: string, choice: string): InboxItem {
    const current = this.item(owner, id)
    if (current.kind !== 'decision' || !current.choices.includes(choice)) throw new ProtocolError('invalid_choice')
    this.db.prepare('UPDATE items SET outcome=?,decided=?,read=coalesce(read,?) WHERE id=? AND owner=? AND outcome IS NULL').run(choice, this.now(), this.now(), id, key(owner))
    return this.item(owner, id)
  }

  push(id: string): PushRecord | undefined {
    const found = this.db.prepare('SELECT id,item_id AS itemId,scheduled,sent,status,error,shown,clicked,opened FROM pushes WHERE id=?').get(id)
    return found ? { ...found } as unknown as PushRecord : undefined
  }

  pushes(owner: Owner): PushRecord[] {
    return this.db.prepare('SELECT id,item_id AS itemId,scheduled,sent,status,error,shown,clicked,opened FROM pushes WHERE owner=? ORDER BY scheduled DESC LIMIT 200').all(key(owner)).map(found => ({ ...found }) as unknown as PushRecord)
  }
}

function row(found: Record<string, unknown>): InboxItem {
  return { id: String(found.id), kind: found.kind as InboxItem['kind'], title: String(found.title), body: String(found.body), choices: JSON.parse(String(found.choices)) as string[], outcome: (found.outcome as string | null) ?? null, created: Number(found.created), decided: (found.decided as number | null) ?? null, read: (found.read as number | null) ?? null }
}
