import { createHash } from 'node:crypto'
import { archiveNotStarted } from '../../contracts/network-capabilities'
import { canonicalNetworkJson as canonicalJson } from '../../contracts/network-json'
import type { PodDatabase } from '../storage/database'
import { digest } from '../storage/database'
import type { ApprovalService, Approvals } from './approvals'

/**
 * The authorized mail effect service (issue 1465, ported from the approve-route archive port): it moves one
 * owner-approved message into the mailbox Archive folder at most once per message version. Microsoft Graph has no
 * atomic conditional move, so every move needs the approval's still active grant, a fresh read immediately before it
 * that matches the approved sender and subject, and an unchanged content version.
 */
export interface ArchiveTools { read: (argv: string[]) => Promise<unknown>, move: (argv: string[]) => Promise<unknown> }
export interface ArchiveTarget { application: string, mailbox: string, approval: string }
export interface ArchiveOutcome { approval: string, messageId: string, outcome: 'archived' | 'skipped' | 'unknown', reason: string }
interface ProviderMail { id: string, changeKey: string, parentFolderId: string, from?: unknown, toRecipients?: unknown[], ccRecipients?: unknown[], subject?: unknown, receivedDateTime?: unknown, body?: { content?: unknown }, hasAttachments?: unknown }
type Settled = 'confirmed_applied' | 'confirmed_not_applied' | 'unknown'

export function parseArchiveTarget(value: unknown): ArchiveTarget {
  const target = value as Partial<ArchiveTarget> | null
  if (!target || typeof target !== 'object' || Array.isArray(target) || Object.keys(target).some(key => !['application', 'mailbox', 'approval'].includes(key))) throw new Error('Archive needs exactly application, mailbox and approval')
  if (typeof target.application !== 'string' || !target.application || target.application.length > 200) throw new Error('Archive needs the assigned mail application')
  if (typeof target.mailbox !== 'string' || !/^[^\s@]+@[^\s.@]+\.[^\s@]+$/.test(target.mailbox)) throw new Error('Archive needs the exact mailbox address')
  if (typeof target.approval !== 'string' || !/^[a-f0-9-]{36}$/.test(target.approval)) throw new Error('Archive needs the approval of this message')
  return { application: target.application, mailbox: target.mailbox, approval: target.approval }
}

// eslint-disable-next-line no-control-regex
const clean = (value: unknown, limit: number) => String(value ?? '').replace(/[\x00-\x1F\u202A-\u202E\u2066-\u2069]/g, ' ').slice(0, limit)
const address = (value: unknown): string => ((value as { emailAddress?: { address?: string } } | null)?.emailAddress?.address ?? '').trim().toLowerCase()
/** The content version of the mail Intake and Mail Sync: read, flag and category changes keep it. */
export function mailContentVersion(mail: ProviderMail): string {
  const fields = [address(mail.from), (mail.toRecipients ?? []).map(address), (mail.ccRecipients ?? []).map(address), mail.subject, mail.receivedDateTime, mail.body?.content, mail.hasAttachments === true]
  return `content:${createHash('sha256').update(JSON.stringify(fields)).digest('hex')}`
}

function workflowReply(value: unknown, mailbox: string, operation: 'read' | 'move'): Record<string, unknown> {
  const reply = typeof value === 'object' && value !== null && 'stdout' in value ? JSON.parse(String((value as { stdout: unknown }).stdout)) as Record<string, unknown> : null
  if ((value as { exitCode?: unknown }).exitCode !== 0 || !reply || reply.protocol !== 'pods-mail/v1' || reply.account !== mailbox || reply.operation !== operation || !['confirmed', 'notApplied', 'unknown'].includes(reply.outcome as string)) throw new Error('Mail application returned no valid workflow receipt')
  return reply
}

function receipt(store: PodDatabase, key: string, attempt: number, outcome: string, body: unknown): void {
  const sequence = Number(store.db.prepare('SELECT coalesce(max(sequence),0) AS sequence FROM effect_receipts WHERE action_key=? AND attempt=?').get(key, attempt)!.sequence) + 1
  store.db.prepare('INSERT INTO effect_receipts VALUES(?,?,?,?,?,?)').run(key, attempt, sequence, outcome, JSON.stringify(body), Date.now())
}

/** Mailbox-wide: an unresolved move of any version of this message may have happened, so it is never moved again. */
function unresolvedMove(store: PodDatabase, mailbox: string, messageId: string): boolean {
  return !!store.db.prepare(`SELECT 1 FROM effect_attempts attempt JOIN effect_receipts intent ON intent.action_key=attempt.action_key AND intent.attempt=attempt.attempt AND intent.outcome='intent'
    WHERE attempt.operation='mail.archive' AND attempt.state IN ('intent','unknown') AND lower(json_extract(intent.body,'$.mailbox'))=lower(?) AND json_extract(intent.body,'$.messageId')=? LIMIT 1`).get(mailbox, messageId)
}

function settle(store: PodDatabase, key: string, attempt: number, state: Settled, body: Record<string, unknown>): void {
  store.transaction(() => {
    // A restart may already have marked the attempt unknown; its late outcome is left to owner reconciliation.
    if (store.db.prepare('UPDATE effect_attempts SET state=? WHERE action_key=? AND attempt=? AND state=\'intent\'').run(state, key, attempt).changes !== 1) throw new Error('Archive outcome arrived after its attempt was settled')
    receipt(store, key, attempt, state, body)
  })
}

export async function archiveApproved(store: PodDatabase, approvals: Approvals, service: ApprovalService, scope: { podId: string, runId: string }, target: ArchiveTarget, tools: ArchiveTools, assertCurrent: () => void, signal: AbortSignal): Promise<ArchiveOutcome> {
  const approval = approvals.get(scope.podId, target.approval)
  const payload = approval.payload as { mailbox?: unknown, messageId?: unknown, version?: unknown, sender?: unknown, subject?: unknown }
  if (approval.action !== 'mail.archive' || typeof payload.messageId !== 'string' || typeof payload.version !== 'string' || typeof payload.subject !== 'string' || typeof payload.sender !== 'string' || String(payload.mailbox).toLowerCase() !== target.mailbox.toLowerCase() || approval.object !== `${target.mailbox.toLowerCase()}:${payload.messageId}`) throw new Error('The approval does not name a message of this mailbox')
  const messageId = payload.messageId; const version = payload.version
  const key = digest(canonicalJson(['mail.archive', target.mailbox.toLowerCase(), messageId, version]))
  const skipped = (reason: string): ArchiveOutcome => ({ approval: approval.id, messageId, outcome: 'skipped', reason })
  const previous = store.db.prepare('SELECT attempt,state FROM effect_attempts WHERE action_key=? ORDER BY attempt DESC').all(key)
  if (previous.some(row => row.state === 'confirmed_applied')) return { approval: approval.id, messageId, outcome: 'archived', reason: 'Already archived' }
  if (unresolvedMove(store, target.mailbox, messageId)) return skipped('An earlier archive attempt of this message awaits reconciliation')
  if (approval.state !== 'approved') return skipped(`The approval is ${approval.state}`)
  const attempt = Number(previous[0]?.attempt ?? 0) + 1
  const input = { messageId, version, mailbox: target.mailbox, approval: approval.id }
  store.transaction(() => {
    store.db.prepare('INSERT INTO effect_attempts VALUES(?,?,?,?,\'mail.archive\',?,\'intent\',?,?)').run(key, attempt, scope.podId, scope.runId, digest(canonicalJson(input)), canonicalJson({ approval: approval.id }), Date.now())
    receipt(store, key, attempt, 'intent', input)
  })
  const progress = { dispatched: false }
  const outcome = await archiveOne(messageId, version, payload, target, tools, async () => { await approvals.consume(scope.podId, approval.id, service, signal); assertCurrent() }, assertCurrent, progress).catch((error: unknown) => {
    const reason = error instanceof Error ? error.message.slice(0, 500) : 'Archive outcome unavailable'
    return { state: progress.dispatched && !reason.startsWith(archiveNotStarted) ? 'unknown' as const : 'confirmed_not_applied' as const, reason, receipt: null }
  })
  settle(store, key, attempt, outcome.state, { reason: outcome.reason, receipt: outcome.receipt })
  return { approval: approval.id, messageId, outcome: outcome.state === 'confirmed_applied' ? 'archived' : outcome.state === 'unknown' ? 'unknown' : 'skipped', reason: outcome.reason }
}

async function archiveOne(messageId: string, version: string, approved: { sender?: unknown, subject?: unknown }, target: ArchiveTarget, tools: ArchiveTools, authorize: () => Promise<void>, assertCurrent: () => void, progress: { dispatched: boolean }): Promise<{ state: Settled, reason: string, receipt: unknown }> {
  const read = workflowReply(await tools.read(['workflow', 'read', '--account', target.mailbox, '--message', messageId]), target.mailbox, 'read')
  assertCurrent()
  if (read.outcome === 'notApplied') return { state: 'confirmed_not_applied', reason: `Message unavailable: ${String(read.reason ?? 'not found').slice(0, 200)}`, receipt: null }
  const items = read.items as ProviderMail[] | undefined
  const mail = items?.[0]
  if (read.outcome !== 'confirmed' || items?.length !== 1 || !mail || mail.id !== messageId || typeof mail.changeKey !== 'string' || !mail.changeKey || typeof mail.parentFolderId !== 'string' || !mail.parentFolderId) throw new Error('Mail preflight read did not return the approved message')
  if (mailContentVersion(mail) !== version) return { state: 'confirmed_not_applied', reason: 'Message changed after approval; it stays in place', receipt: null }
  // The owner approved what the request showed; a message that now names something else must not move.
  if (approved.subject !== clean(mail.subject, 160) || approved.sender !== clean(address(mail.from), 120)) return { state: 'confirmed_not_applied', reason: 'Message does not match the approved sender and subject', receipt: null }
  await authorize()
  progress.dispatched = true
  const moved = workflowReply(await tools.move(['workflow', 'move', '--account', target.mailbox, '--message', messageId, '--expected-version', mail.changeKey, '--source-folder', mail.parentFolderId, '--destination', 'archive']), target.mailbox, 'move')
  if (moved.outcome === 'notApplied') return { state: 'confirmed_not_applied', reason: `Provider did not move the message: ${String(moved.reason ?? 'not applied').slice(0, 200)}`, receipt: null }
  const after = moved.receipt as ProviderMail | undefined
  if (moved.outcome !== 'confirmed' || moved.beforeId !== messageId || typeof moved.afterId !== 'string' || after?.id !== moved.afterId || typeof after.parentFolderId !== 'string' || after.parentFolderId === mail.parentFolderId || typeof moved.requestId !== 'string' || !moved.requestId) return { state: 'unknown', reason: 'Move receipt could not be bound to the approved message', receipt: { requestId: moved.requestId ?? null } }
  return { state: 'confirmed_applied', reason: 'Moved to the Archive folder', receipt: { beforeId: messageId, afterId: moved.afterId, folder: after.parentFolderId, requestId: moved.requestId } }
}
