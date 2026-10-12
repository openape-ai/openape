import { randomUUID } from 'node:crypto'
import type { Owner } from '@openape/pods-protocol'
import { approvalActions, parseApprovalAuthority } from '../../contracts/approvals'
import type { ApprovalAction, ApprovalAuthority, ApprovalManifest, ApprovalState, ApprovalView } from '../../contracts/approvals'
import { plainJson } from '../../contracts/domain-data'
import { canonicalNetworkJson as canonicalJson } from '../../contracts/network-json'
import type { PodDatabase } from '../storage/database'
import { digest } from '../storage/database'

export type ApprovalService = (body: { operation: 'create' | 'status' | 'consume' | 'assertActive', manifest: ApprovalManifest, grants?: { key: string, id: string }[] }, signal: AbortSignal) => Promise<unknown>
interface Row { id: string, pod_id: string, action: ApprovalAction, object: string, payload: string, payload_hash: string, title: string, authority: string, batch_id: string | null, grant_id: string | null, state: ApprovalState, reason: string | null, released_at: number | null, created_at: number, updated_at: number }
interface Batch { id: string, pod_id: string, title: string, expires_at: number, url: string | null, next_poll_at: number, polls: number }

/**
 * Collection and batching follow the former approve routes (issues 1449, 1458): requests collect until two quiet
 * minutes or ten minutes passed, up to 30 per IdP request, and join one open IdP batch for seven days and 100 grants.
 */
export const approvalLimits = { items: 30, members: 100, expiryMs: 7 * 24 * 60 * 60 * 1000, joinMarginMs: 60 * 60 * 1000, quietMs: 2 * 60 * 1000, maxMs: 10 * 60 * 1000, fastPolls: 120, slowPollMs: 60_000, payloadBytes: 16 * 1024 } as const
const batchTitles: Record<ApprovalAction, string> = { 'mail.archive': 'Archive newsletters' }

function row(value: unknown): Row { return value as Row }
// eslint-disable-next-line no-control-regex
const line = (value: unknown, limit: number) => String(value).replace(/[\u0000-\u001F\u007F\u202A-\u202E\u2066-\u2069]+/g, ' ').trim().slice(0, limit)

/** Each action fixes its payload fields, its object identity and the title the owner reads at the IdP. */
export function actionTitle(action: ApprovalAction, object: string, payload: Record<string, unknown>): string {
  if (action === 'mail.archive') {
    const fields = ['mailbox', 'messageId', 'version', 'subject', 'sender']
    if (Object.keys(payload).some(key => !fields.includes(key)) || fields.some(key => typeof payload[key] !== 'string' || !String(payload[key]).trim())) throw new Error('A mail archive approval names mailbox, messageId, version, subject and sender')
    if (object !== `${String(payload.mailbox).toLowerCase()}:${String(payload.messageId)}`) throw new Error('A mail archive approval object is the mailbox and message ID')
    return `${line(payload.subject, 80)} · ${line(payload.sender, 38)}`.slice(0, 120)
  }
  throw new Error('Unsupported approval action')
}

export class Approvals {
  collect: { quietMs: number, maxMs: number } = { quietMs: approvalLimits.quietMs, maxMs: approvalLimits.maxMs }
  constructor(private readonly store: PodDatabase, private readonly owner: () => Owner) {}

  private view(item: Row): ApprovalView {
    const url = item.batch_id ? this.store.db.prepare('SELECT url FROM approval_batches WHERE id=?').get(item.batch_id)?.url as string | null ?? null : null
    return { id: item.id, action: item.action, object: item.object, title: item.title, state: item.state, reason: item.reason, batchUrl: url, updatedAt: item.updated_at }
  }

  private assertRun(principal: { podId: string, runId: string }): void {
    if (!this.store.db.prepare('SELECT 1 FROM run_leases WHERE pod_id=? AND run_id=? AND boot_id NOT LIKE \'fenced:%\'').get(principal.podId, principal.runId)) throw new Error('Approvals require the Pod\'s active run')
  }

  /**
   * Asks the owner to approve one exact action. The same action, object and payload return the earlier request;
   * a changed payload withdraws every earlier open or approved request for the object, since an approval never
   * carries over to other content.
   */
  request(principal: { podId: string, runId: string }, value: unknown): ApprovalView {
    const input = plainJson(value) as Record<string, unknown>
    if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => !['action', 'object', 'title', 'payload'].includes(key))) throw new Error('Invalid approval request')
    if (!approvalActions.includes(input.action as ApprovalAction) || typeof input.object !== 'string' || !input.object || input.object.length > 500 || (input.title !== undefined && typeof input.title !== 'string')) throw new Error('An approval names an action and its object')
    const payload = input.payload as Record<string, unknown>
    if (!payload || typeof payload !== 'object' || Array.isArray(payload) || canonicalJson(payload).length > approvalLimits.payloadBytes) throw new Error('Approval payload is limited to 16 KiB')
    // What the owner sees at the IdP is derived from the bound payload, never from text the script chose.
    const title = actionTitle(input.action as ApprovalAction, input.object as string, payload)
    const hash = digest(canonicalJson(payload))
    return this.store.transaction(() => {
      this.assertRun(principal)
      const existing = this.store.db.prepare('SELECT * FROM action_approvals WHERE pod_id=? AND action=? AND object=? AND payload_hash=?').get(principal.podId, input.action as string, input.object as string, hash)
      if (existing) return this.view(row(existing))
      const now = Date.now()
      this.store.db.prepare(`UPDATE action_approvals SET state='withdrawn',reason='The object changed; this approval does not cover the new content',updated_at=? WHERE pod_id=? AND action=? AND object=? AND state IN ('collecting','requested','approved')`).run(now, principal.podId, input.action as string, input.object as string)
      const id = randomUUID()
      this.store.db.prepare('INSERT INTO action_approvals(id,pod_id,action,object,payload,payload_hash,title,authority,state,created_at,updated_at) VALUES(?,?,?,?,?,?,?,\'{}\',\'collecting\',?,?)').run(id, principal.podId, input.action as string, input.object as string, canonicalJson(payload), hash, title, now, now)
      return this.view(row(this.store.db.prepare('SELECT * FROM action_approvals WHERE id=?').get(id)))
    })
  }

  get(podId: string, id: string): ApprovalView & { payload: Record<string, unknown> } {
    const item = this.store.db.prepare('SELECT * FROM action_approvals WHERE id=? AND pod_id=?').get(String(id), podId)
    if (!item) throw new Error('Approval not found for this Pod')
    return { ...this.view(row(item)), payload: JSON.parse(row(item).payload) as Record<string, unknown> }
  }

  /** Whether a run of the Pod has approval work: a collection ready to request or a request to read. */
  due(podId: string, now = Date.now()): boolean {
    if (this.store.db.prepare('SELECT 1 FROM action_approvals WHERE pod_id=? AND (state=\'requested\' OR (state=\'approved\' AND batch_id IS NOT NULL)) LIMIT 1').get(podId)) return true
    const collecting = this.store.db.prepare('SELECT count(*) AS count,min(created_at) AS first,max(created_at) AS last FROM action_approvals WHERE pod_id=? AND state=\'collecting\'').get(podId)!
    return Number(collecting.count) > 0 && this.ready(Number(collecting.count), Number(collecting.first), Number(collecting.last), now)
  }

  private ready(count: number, first: number, last: number, now: number): boolean {
    return count >= approvalLimits.items || now - last >= this.collect.quietMs || now - first >= this.collect.maxMs
  }

  private manifest(batch: Batch, items: Row[]): ApprovalManifest {
    return { podId: batch.pod_id, owner: this.owner(), batchId: batch.id, title: batch.title, expiresAt: batch.expires_at, items: items.map(item => ({ key: item.id, authority: parseApprovalAuthority(JSON.parse(item.authority)), summary: item.title })) }
  }

  /** The open IdP batch of a Pod and action while it has life and room left; otherwise a new one. */
  private batch(podId: string, action: ApprovalAction, now: number): Batch {
    const open = this.store.db.prepare(`SELECT b.*,(SELECT count(*) FROM action_approvals a WHERE a.batch_id=b.id) AS members FROM approval_batches b
      WHERE b.pod_id=? AND b.title=? AND b.expires_at-?>=? ORDER BY b.created_at DESC LIMIT 1`).get(podId, batchTitles[action], now, approvalLimits.joinMarginMs)
    if (open && Number(open.members) < approvalLimits.members) return open as unknown as Batch
    const id = randomUUID()
    this.store.db.prepare('INSERT INTO approval_batches(id,pod_id,title,expires_at,next_poll_at,created_at) VALUES(?,?,?,?,?,?)').run(id, podId, batchTitles[action], now + approvalLimits.expiryMs, now, now)
    return this.store.db.prepare('SELECT * FROM approval_batches WHERE id=?').get(id) as unknown as Batch
  }

  /**
   * One approval step inside a Pod run: requests collected items at the IdP and reads the decisions of requested ones.
   * A request whose IdP outcome is uncertain becomes unknown and is never repeated automatically.
   */
  async sync(podId: string, service: ApprovalService, signal: AbortSignal, now = Date.now()): Promise<void> {
    this.store.db.prepare(`UPDATE action_approvals SET state='unknown',reason='The approval request was interrupted; its outcome at the IdP is unknown',updated_at=? WHERE pod_id=? AND state='requested' AND grant_id IS NULL`).run(now, podId)
    for (const action of approvalActions) await this.requestAtIdp(podId, action, service, signal, now)
    for (const batch of this.store.db.prepare('SELECT DISTINCT b.* FROM approval_batches b JOIN action_approvals a ON a.batch_id=b.id WHERE b.pod_id=? AND a.state=\'requested\' AND b.next_poll_at<=?').all(podId, now) as unknown as Batch[]) {
      signal.throwIfAborted()
      await this.poll(batch, service, signal, now)
    }
  }

  private async requestAtIdp(podId: string, action: ApprovalAction, service: ApprovalService, signal: AbortSignal, now: number): Promise<void> {
    const prepared = this.store.transaction(() => {
      const collecting = this.store.db.prepare('SELECT * FROM action_approvals WHERE pod_id=? AND action=? AND state=\'collecting\' ORDER BY created_at,id').all(podId, action).map(row)
      if (!collecting.length || !this.ready(collecting.length, collecting[0]!.created_at, collecting.at(-1)!.created_at, now)) return null
      const batch = this.batch(podId, action, now)
      const room = approvalLimits.members - Number(this.store.db.prepare('SELECT count(*) AS count FROM action_approvals WHERE batch_id=?').get(batch.id)!.count)
      const items = collecting.slice(0, Math.min(approvalLimits.items, room))
      for (const item of items) {
        const authority: ApprovalAuthority = { version: 5, podId, owner: this.owner(), batchId: batch.id, expiresAt: batch.expires_at, action, object: item.object, hash: item.payload_hash }
        // Journal first: an interrupted request is unknown afterwards, never sent twice.
        this.store.db.prepare('UPDATE action_approvals SET state=\'requested\',authority=?,batch_id=?,updated_at=? WHERE id=? AND state=\'collecting\'').run(canonicalJson(authority), batch.id, now, item.id)
      }
      return { batch, items: items.map(item => row(this.store.db.prepare('SELECT * FROM action_approvals WHERE id=?').get(item.id))) }
    })
    if (!prepared) return
    try {
      const reply = await service({ operation: 'create', manifest: this.manifest(prepared.batch, prepared.items) }, signal) as { url?: unknown, grants?: unknown }
      const grants = reply?.grants as { key?: unknown, id?: unknown }[] | undefined
      const url = typeof reply?.url === 'string' ? new URL(reply.url) : null
      if (!url || (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname))) || !Array.isArray(grants) || grants.length !== prepared.items.length || prepared.items.some(item => grants.filter(grant => grant?.key === item.id && typeof grant.id === 'string' && /^[\w-]{1,128}$/.test(grant.id)).length !== 1)) throw new Error('The IdP did not name one grant per approval')
      this.store.transaction(() => {
        for (const grant of grants) this.store.db.prepare('UPDATE action_approvals SET grant_id=?,updated_at=? WHERE id=? AND state=\'requested\' AND grant_id IS NULL').run(String(grant.id), Date.now(), String(grant.key))
        this.store.db.prepare('UPDATE approval_batches SET url=?,next_poll_at=?,error=NULL WHERE id=?').run(url.href, Date.now() + 5000, prepared.batch.id)
      })
    }
    catch (error) {
      const reason = `The IdP request failed or its outcome is unknown: ${error instanceof Error ? error.message : 'no answer'}`.slice(0, 2000)
      this.store.db.prepare(`UPDATE action_approvals SET state='unknown',reason=?,updated_at=? WHERE batch_id=? AND state='requested' AND grant_id IS NULL`).run(reason, Date.now(), prepared.batch.id)
      throw error
    }
  }

  private async poll(batch: Batch, service: ApprovalService, signal: AbortSignal, now: number): Promise<void> {
    const items = this.store.db.prepare('SELECT * FROM action_approvals WHERE batch_id=? AND state=\'requested\' AND grant_id IS NOT NULL ORDER BY created_at,id').all(batch.id).map(row)
    if (!items.length) return
    this.store.db.prepare('UPDATE approval_batches SET polls=polls+1,next_poll_at=? WHERE id=?').run(now + (batch.polls < approvalLimits.fastPolls ? 5000 : approvalLimits.slowPollMs), batch.id)
    let states: Record<string, unknown>
    try { states = await service({ operation: 'status', manifest: this.manifest(batch, items), grants: items.map(item => ({ key: item.id, id: item.grant_id! })) }, signal) as Record<string, unknown> }
    catch (error) {
      this.store.db.prepare('UPDATE approval_batches SET error=? WHERE id=?').run((error instanceof Error ? error.message : 'Approval status unavailable').slice(0, 2000), batch.id)
      return
    }
    this.store.transaction(() => {
      for (const item of items) {
        const state = states?.[item.id]
        if (!['pending', 'approved', 'denied', 'expired'].includes(state as string)) throw new Error('Invalid approval status')
        if (state === 'pending') continue
        // Nobody answered before the batch expired: the item asks again in a fresh request instead of ending.
        if (state === 'expired') this.store.db.prepare(`UPDATE action_approvals SET state='collecting',authority='{}',batch_id=NULL,grant_id=NULL,reason=?,updated_at=? WHERE id=?`).run(`Unanswered request ${item.grant_id} expired; asking again`, Date.now(), item.id)
        else this.store.db.prepare('UPDATE action_approvals SET state=?,reason=?,updated_at=? WHERE id=?').run(state as string, state === 'denied' ? 'Denied by the owner' : null, Date.now(), item.id)
      }
      this.store.db.prepare('UPDATE approval_batches SET error=NULL WHERE id=?').run(batch.id)
    })
  }

  /** Uses the approval for exactly one action: a once grant is consumed at the IdP, then it is verified active. */
  async consume(podId: string, id: string, service: ApprovalService, signal: AbortSignal): Promise<Row> {
    const item = row(this.store.db.prepare('SELECT * FROM action_approvals WHERE id=? AND pod_id=?').get(id, podId))
    if (!item || item.state !== 'approved' || !item.batch_id || !item.grant_id) throw new Error(`The approval is ${item?.state ?? 'missing'}; nothing may happen without an approved request`)
    const batch = this.store.db.prepare('SELECT * FROM approval_batches WHERE id=?').get(item.batch_id) as unknown as Batch
    if (batch.expires_at <= Date.now()) throw new Error('The approval expired before it was used')
    const body = { manifest: this.manifest(batch, [item]), grants: [{ key: item.id, id: item.grant_id }] }
    try {
      if (await service({ operation: 'consume', ...body }, signal) !== true) throw new Error('The approval was not confirmed by the IdP')
    }
    catch (error) {
      // Whether the IdP used the grant up is unknown; the owner asks again instead of a silent second use.
      this.store.db.prepare('UPDATE action_approvals SET state=\'unknown\',reason=?,updated_at=? WHERE id=? AND state=\'approved\'').run(`Using the approval failed: ${error instanceof Error ? error.message : 'no answer'}`.slice(0, 2000), Date.now(), id)
      throw error
    }
    this.store.db.prepare('UPDATE action_approvals SET state=\'consumed\',updated_at=? WHERE id=? AND state=\'approved\'').run(Date.now(), id)
    if (await service({ operation: 'assertActive', ...body }, signal) !== true) throw new Error('The approval is no longer active')
    return item
  }

  /** The desktop's check that a batch operation names exactly the stored requests of this Pod. */
  authorize(podId: string, manifest: ApprovalManifest, operation: string, grants: { key: string, id: string }[] = []): void {
    if (manifest.podId !== podId) throw new Error('Approval batch belongs to another Pod')
    const states: Record<string, ApprovalState[]> = { create: ['requested'], status: ['requested'], consume: ['approved'], assertActive: ['consumed'] }
    for (const item of manifest.items) {
      const stored = row(this.store.db.prepare('SELECT * FROM action_approvals WHERE id=? AND pod_id=?').get(item.key, podId))
      if (!stored || stored.batch_id !== manifest.batchId || stored.authority !== canonicalJson(item.authority) || !states[operation]?.includes(stored.state)) throw new Error('Approval operation does not match the stored request')
      const grant = grants.find(entry => entry.key === item.key)
      if (operation !== 'create' && (!grant || grant.id !== stored.grant_id)) throw new Error('Approval grant does not match the stored request')
    }
  }

  /** Finished requests whose grants the desktop revokes or withdraws at the IdP, grouped by batch. */
  releasable(limit = 4): { podId: string, manifest: ApprovalManifest, grants: { key: string, id: string }[] }[] {
    return this.store.db.prepare(`SELECT DISTINCT b.* FROM approval_batches b JOIN action_approvals a ON a.batch_id=b.id WHERE a.grant_id IS NOT NULL AND a.released_at IS NULL AND a.state IN ('consumed','denied','withdrawn') ORDER BY b.created_at LIMIT ?`).all(limit).map((value) => {
      const batch = value as unknown as Batch
      const items = this.store.db.prepare('SELECT * FROM action_approvals WHERE batch_id=? AND grant_id IS NOT NULL AND released_at IS NULL AND state IN (\'consumed\',\'denied\',\'withdrawn\')').all(batch.id).map(row)
      return { podId: batch.pod_id, manifest: this.manifest(batch, items), grants: items.map(item => ({ key: item.id, id: item.grant_id! })) }
    })
  }

  released(keys: string[]): void {
    for (const key of keys) this.store.db.prepare('UPDATE action_approvals SET released_at=? WHERE id=? AND released_at IS NULL').run(Date.now(), key)
  }

  views(states: ApprovalState[] = ['collecting', 'requested', 'approved', 'unknown']): (ApprovalView & { podId: string })[] {
    return this.store.db.prepare(`SELECT * FROM action_approvals WHERE state IN (${states.map(() => '?').join(',')}) ORDER BY created_at DESC LIMIT 500`).all(...states).map(item => ({ ...this.view(row(item)), podId: row(item).pod_id }))
  }

  /** Owner command for an uncertain request: ask again (a fresh request) or withdraw it; neither approves anything. */
  resolve(id: string, decision: 'renew' | 'withdraw', evidence: string): void {
    if (!evidence.trim()) throw new Error('Resolving an uncertain approval needs the owner\'s observation')
    const changed = decision === 'renew'
      ? this.store.db.prepare(`UPDATE action_approvals SET state='collecting',authority='{}',batch_id=NULL,grant_id=NULL,reason=?,updated_at=? WHERE id=? AND state='unknown'`).run(`Asked again by the owner: ${evidence.slice(0, 1800)}`, Date.now(), id)
      : this.store.db.prepare(`UPDATE action_approvals SET state='withdrawn',reason=?,updated_at=? WHERE id=? AND state='unknown'`).run(`Withdrawn by the owner: ${evidence.slice(0, 1800)}`, Date.now(), id)
    if (changed.changes !== 1) throw new Error('Only an uncertain approval can be renewed or withdrawn')
  }
}
