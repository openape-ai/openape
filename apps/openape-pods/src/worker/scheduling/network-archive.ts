import { createHash } from 'node:crypto'
import { canonicalNetworkJson } from '../../contracts/network-json'
import type { NetworkGateCoverage } from '../../contracts/network-gates'
import type { PodDatabase } from '../storage/database'
import { digest } from '../storage/database'

export interface ArchiveTarget { application: string, mailbox: string }
export interface ArchiveTools {
  read: (argv: string[]) => Promise<unknown>
  move: (argv: string[]) => Promise<unknown>
}
export interface ArchiveOutcome { deliveryId: string, messageId: string | null, outcome: 'archived' | 'skipped' | 'unknown', reason: string }
interface ArchiveScope { networkId: string, runId: string, podId: string, owner: { issuer: string, subject: string } }
interface ProviderMail { id: string, changeKey: string, parentFolderId: string, from?: unknown, toRecipients?: unknown[], ccRecipients?: unknown[], subject?: unknown, receivedDateTime?: unknown, body?: { content?: unknown }, hasAttachments?: unknown }
type Settled = 'confirmed_applied' | 'confirmed_not_applied' | 'unknown'

export function parseArchiveTarget(value: unknown): ArchiveTarget {
  const target = value as Partial<ArchiveTarget> | null
  if (!target || typeof target !== 'object' || Array.isArray(target) || Object.keys(target).some(key => !['application', 'mailbox'].includes(key))) throw new Error('Archive needs exactly application and mailbox')
  if (typeof target.application !== 'string' || !target.application || target.application.length > 200) throw new Error('Archive needs the assigned mail application')
  if (typeof target.mailbox !== 'string' || !/^[^\s@]+@[^\s.@]+\.[^\s@]+$/.test(target.mailbox)) throw new Error('Archive needs the exact mailbox address')
  return { application: target.application, mailbox: target.mailbox }
}

const address = (value: unknown): string => ((value as { emailAddress?: { address?: string } } | null)?.emailAddress?.address ?? '').trim().toLowerCase()
// Same fingerprint as the mail Intake (examples/network-mail-intake.mjs): read, flag and category changes keep it.
export function mailContentVersion(mail: ProviderMail): string {
  const fields = [address(mail.from), (mail.toRecipients ?? []).map(address), (mail.ccRecipients ?? []).map(address), mail.subject, mail.receivedDateTime, mail.body?.content, mail.hasAttachments === true]
  return `content:${createHash('sha256').update(JSON.stringify(fields)).digest('hex')}`
}

function workflowReply(value: unknown, mailbox: string, operation: 'read' | 'move'): Record<string, unknown> {
  const reply = typeof value === 'object' && value !== null && 'stdout' in value ? JSON.parse(String((value as { stdout: unknown }).stdout)) as Record<string, unknown> : null
  if ((value as { exitCode?: unknown }).exitCode !== 0 || !reply || reply.protocol !== 'pods-mail/v1' || reply.account !== mailbox || reply.operation !== operation || !['confirmed', 'notApplied', 'unknown'].includes(reply.outcome as string)) throw new Error('Mail application returned no valid workflow receipt')
  return reply
}

function sourceOf(store: PodDatabase, deliveryId: string) {
  const row = store.db.prepare(`SELECT delivery.case_id,delivery.case_revision,revision.source_mapping FROM network_deliveries delivery
    JOIN network_case_revisions revision ON revision.case_id=delivery.case_id AND revision.revision=delivery.case_revision WHERE delivery.id=?`).get(deliveryId)
  if (!row) throw new Error('Approved delivery has no case')
  const mapping = JSON.parse(row.source_mapping as string) as { sourceItemId?: unknown, sourceVersion?: unknown }
  return { caseId: row.case_id as string, caseRevision: Number(row.case_revision), messageId: typeof mapping.sourceItemId === 'string' ? mapping.sourceItemId : null, version: typeof mapping.sourceVersion === 'string' ? mapping.sourceVersion : null }
}

function receipt(store: PodDatabase, key: string, attempt: number, outcome: string, body: unknown): void {
  const sequence = Number(store.db.prepare('SELECT coalesce(max(sequence),0) AS sequence FROM network_effect_receipts WHERE logical_action_key=? AND attempt=?').get(key, attempt)!.sequence) + 1
  store.db.prepare('INSERT INTO network_effect_receipts VALUES(?,?,?,?,?,?)').run(key, attempt, sequence, outcome, JSON.stringify(body), Date.now())
}

function settle(store: PodDatabase, key: string, attempt: number, state: Settled, body: Record<string, unknown>): void {
  store.transaction(() => {
    store.db.prepare('UPDATE network_effect_attempts SET state=? WHERE logical_action_key=? AND attempt=? AND state=\'intent\'').run(state, key, attempt)
    receipt(store, key, attempt, state, body)
  })
}

/**
 * Moves each owner-approved mail of this invocation into the Archive folder, at most once per message version.
 * Microsoft Graph has no atomic conditional move, so every move is bound to an individual owner once-grant and to a
 * fresh read immediately before it; a changed message is not moved.
 */
export async function archiveApproved(store: PodDatabase, scope: ArchiveScope, coverage: NetworkGateCoverage[], target: ArchiveTarget, tools: ArchiveTools, assertCurrent: () => void): Promise<ArchiveOutcome[]> {
  const outcomes: ArchiveOutcome[] = []
  for (const approval of coverage) {
    const manifestHash = digest(canonicalNetworkJson(approval.manifest))
    for (const item of approval.items) {
      assertCurrent()
      const source = sourceOf(store, item.deliveryId)
      if (!source.messageId || !source.version) { outcomes.push({ deliveryId: item.deliveryId, messageId: null, outcome: 'skipped', reason: 'The case has no mail source' }); continue }
      const key = digest(canonicalNetworkJson([scope.owner.issuer, scope.owner.subject, scope.podId, source.caseId, 'mail.archive', source.messageId, source.version]))
      const previous = store.db.prepare('SELECT attempt,state FROM network_effect_attempts WHERE logical_action_key=? ORDER BY attempt DESC').all(key)
      if (previous.some(row => row.state === 'confirmed_applied')) { outcomes.push({ deliveryId: item.deliveryId, messageId: source.messageId, outcome: 'archived', reason: 'Already archived' }); continue }
      if (previous.some(row => row.state === 'intent' || row.state === 'unknown')) throw new Error('An earlier archive attempt of this message needs reconciliation')
      const attempt = Number(previous[0]?.attempt ?? 0) + 1
      const input = { messageId: source.messageId, version: source.version, mailbox: target.mailbox, deliveryId: item.deliveryId }
      store.transaction(() => {
        store.db.prepare('INSERT INTO network_effect_attempts VALUES(?,?,?,?,?,?,?,\'intent\',?,?)').run(key, attempt, scope.runId, source.caseId, source.caseRevision, digest(canonicalNetworkJson(input)), manifestHash, Date.now(), scope.networkId)
        receipt(store, key, attempt, 'intent', input)
      })
      const progress = { dispatched: false }
      // Only a failure after the move was sent leaves its outcome open.
      const outcome = await archiveOne(source.messageId, source.version, target, tools, assertCurrent, progress).catch((error: unknown) => ({ state: progress.dispatched ? 'unknown' as const : 'confirmed_not_applied' as const, reason: error instanceof Error ? error.message.slice(0, 500) : 'Archive outcome unavailable', receipt: null }))
      settle(store, key, attempt, outcome.state, { reason: outcome.reason, receipt: outcome.receipt })
      outcomes.push({ deliveryId: item.deliveryId, messageId: source.messageId, outcome: outcome.state === 'confirmed_applied' ? 'archived' : outcome.state === 'unknown' ? 'unknown' : 'skipped', reason: outcome.reason })
      if (outcome.state === 'unknown') return outcomes
    }
  }
  return outcomes
}

async function archiveOne(messageId: string, version: string, target: ArchiveTarget, tools: ArchiveTools, assertCurrent: () => void, progress: { dispatched: boolean }): Promise<{ state: Settled, reason: string, receipt: unknown }> {
  const read = workflowReply(await tools.read(['workflow', 'read', '--account', target.mailbox, '--message', messageId]), target.mailbox, 'read')
  assertCurrent()
  if (read.outcome === 'notApplied') return { state: 'confirmed_not_applied', reason: `Message unavailable: ${String(read.reason ?? 'not found').slice(0, 200)}`, receipt: null }
  const items = read.items as ProviderMail[] | undefined
  const mail = items?.[0]
  if (read.outcome !== 'confirmed' || items?.length !== 1 || !mail || mail.id !== messageId || typeof mail.changeKey !== 'string' || !mail.changeKey || typeof mail.parentFolderId !== 'string' || !mail.parentFolderId) throw new Error('Mail preflight read did not return the approved message')
  const current = version.startsWith('content:') ? mailContentVersion(mail) : mail.changeKey
  if (current !== version) return { state: 'confirmed_not_applied', reason: 'Message changed after approval; it stays in place', receipt: null }
  assertCurrent()
  progress.dispatched = true
  const moved = workflowReply(await tools.move(['workflow', 'move', '--account', target.mailbox, '--message', messageId, '--expected-version', mail.changeKey, '--source-folder', mail.parentFolderId, '--destination', 'archive']), target.mailbox, 'move')
  if (moved.outcome === 'notApplied') return { state: 'confirmed_not_applied', reason: `Provider did not move the message: ${String(moved.reason ?? 'not applied').slice(0, 200)}`, receipt: null }
  const after = moved.receipt as ProviderMail | undefined
  if (moved.outcome !== 'confirmed' || moved.beforeId !== messageId || typeof moved.afterId !== 'string' || after?.id !== moved.afterId || typeof after.parentFolderId !== 'string' || after.parentFolderId === mail.parentFolderId || typeof moved.requestId !== 'string' || !moved.requestId) return { state: 'unknown', reason: 'Move receipt could not be bound to the approved message', receipt: { requestId: moved.requestId ?? null } }
  return { state: 'confirmed_applied', reason: 'Moved to the Archive folder', receipt: { beforeId: messageId, afterId: moved.afterId, folder: after.parentFolderId, requestId: moved.requestId } }
}
