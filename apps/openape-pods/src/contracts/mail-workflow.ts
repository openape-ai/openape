export interface ProtectedPartner { kind: 'address' | 'domain', value: string }
export interface ArchiveRule { id: string, enabled: boolean, sender: string, listId: string, subjectPrefix: string }
export interface MailWorkflowConfiguration {
  mailbox: string
  filterPodId: string
  notifyPodId: string
  applicationId: string
  telegramCredential: string
  telegramChatId: string
  protectedPartners: ProtectedPartner[]
  rules: ArchiveRule[]
  mode: 'preview' | 'archive'
}
export interface WorkflowMail {
  id: string
  version: string
  folder: string
  conversation: string
  sender: string
  participants: string[]
  subject: string
  body: string
  receivedAt: number
  listId: string | null
  hasAttachments: boolean
  flagged: boolean
  important: boolean
}
export interface MailMoveReceipt { beforeId: string, afterId: string, version: string, folder: string, requestId: string }
export type MailEffectOutcome<T> = { state: 'confirmed', receipt: T } | { state: 'notApplied' | 'unknown', reason: string }
export interface MailFilterResult { schema: 'mail-filter-result/v1', batchId: string, mailbox: string, baseline: boolean, mode: 'preview' | 'archive', retained: string[], archived: string[], reportReceipts: number[] }
const address = /^[^\s@<>]+@[^\s<>@][^\s.<>@]*\.[^\s<>@]+$/
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/
export function parseMailWorkflowConfiguration(value: unknown): MailWorkflowConfiguration {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid mail workflow configuration')
  const item = value as MailWorkflowConfiguration
  if (Object.keys(item).some(key => !['mailbox', 'filterPodId', 'notifyPodId', 'applicationId', 'telegramCredential', 'telegramChatId', 'protectedPartners', 'rules', 'mode'].includes(key)) || typeof item.mailbox !== 'string' || item.mailbox.length > 320 || !address.test(item.mailbox) || typeof item.filterPodId !== 'string' || !uuid.test(item.filterPodId) || typeof item.notifyPodId !== 'string' || !uuid.test(item.notifyPodId) || item.filterPodId === item.notifyPodId || typeof item.applicationId !== 'string' || !uuid.test(item.applicationId) || typeof item.telegramCredential !== 'string' || !/^[a-z][a-z0-9_]{0,63}$/.test(item.telegramCredential) || typeof item.telegramChatId !== 'string' || !/^-?\d{1,20}$/.test(item.telegramChatId) || !['preview', 'archive'].includes(item.mode)) throw new Error('Invalid mail workflow account, pods or destination')
  if (!Array.isArray(item.protectedPartners) || item.protectedPartners.length > 500 || !Array.isArray(item.rules) || item.rules.length > 100) throw new Error('Mail workflow policy exceeds its limit')
  for (const partner of item.protectedPartners) {
    if (!partner || Object.keys(partner).some(key => !['kind', 'value'].includes(key)) || typeof partner.value !== 'string' || partner.value.length > 320 || (partner.kind === 'address' ? !address.test(partner.value) : partner.kind !== 'domain' || !/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/i.test(partner.value))) throw new Error('Use an exact email address or domain for protected partners')
  }
  const ids = new Set<string>()
  for (const rule of item.rules) {
    if (!rule || Object.keys(rule).some(key => !['id', 'enabled', 'sender', 'listId', 'subjectPrefix'].includes(key)) || typeof rule.id !== 'string' || !/^[a-z0-9-]{1,64}$/.test(rule.id) || ids.has(rule.id) || typeof rule.enabled !== 'boolean' || typeof rule.sender !== 'string' || !address.test(rule.sender) || typeof rule.listId !== 'string' || !rule.listId.trim() || rule.listId.length > 200 || typeof rule.subjectPrefix !== 'string' || !rule.subjectPrefix.trim() || rule.subjectPrefix.length > 200) throw new Error('Archive rules need an exact sender, list identity and subject prefix')
    ids.add(rule.id)
  }
  return JSON.parse(JSON.stringify(item)) as MailWorkflowConfiguration
}
export function parseWorkflowMail(value: unknown): WorkflowMail {
  if (!value || typeof value !== 'object') throw new Error('Invalid workflow mail message')
  const item = value as WorkflowMail
  for (const key of ['id', 'version', 'folder', 'conversation', 'sender', 'subject', 'body'] as const) {
    if (typeof item[key] !== 'string' || item[key].length > (key === 'body' ? 1000000 : 4096)) throw new Error('Invalid workflow mail message fields')
  }
  if (!item.id || !item.version || !item.folder || !Number.isSafeInteger(item.receivedAt) || !Array.isArray(item.participants) || item.participants.length > 1000 || item.participants.some(value => typeof value !== 'string' || !address.test(value)) || !address.test(item.sender) || (item.listId !== null && typeof item.listId !== 'string') || typeof item.hasAttachments !== 'boolean' || typeof item.flagged !== 'boolean' || typeof item.important !== 'boolean') throw new Error('Incomplete workflow mail identity or content')
  return item
}
export interface MailBatchReview {
  batchId: string
  mailbox: string
  phase: string
  baseline: boolean
  items: { id: string, sender: string, subject: string, disposition: string, reason: string, receipt?: MailMoveReceipt }[]
  deliveries: { key: string, body: string, state: string, messageId?: number, reason?: string }[]
  effects: { key: string, operation: string, runId: string, podId: string, state: string }[]
}
export interface MailEffectResolution { batchId: string, key: string, outcome: 'confirmed' | 'notApplied', messageId?: number, move?: MailMoveReceipt, evidence: string }
export function parseMailEffectResolution(value: unknown): MailEffectResolution {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid mail effect resolution')
  const item = value as MailEffectResolution
  if (Object.keys(item).some(key => !['batchId', 'key', 'outcome', 'messageId', 'move', 'evidence'].includes(key)) || !uuid.test(item.batchId) || typeof item.key !== 'string' || !/^[\w.:-]{1,160}$/.test(item.key) || !['confirmed', 'notApplied'].includes(item.outcome) || typeof item.evidence !== 'string' || item.evidence.trim().length < 10 || item.evidence.length > 4000 || (item.messageId !== undefined && (!Number.isSafeInteger(item.messageId) || item.messageId < 1))) throw new Error('Record concrete delivery or move evidence before reconciling')
  if (item.move && (Object.keys(item.move).some(key => !['beforeId', 'afterId', 'version', 'folder', 'requestId'].includes(key)) || Object.values(item.move).some(value => typeof value !== 'string' || !value || value.length > 4096) || !item.move.beforeId || !item.move.afterId || !item.move.version || !item.move.folder || !item.move.requestId)) throw new Error('A confirmed move requires its complete provider receipt')
  return item
}
export function parseMailBatchReview(value: unknown): MailBatchReview {
  if (!value || typeof value !== 'object') throw new Error('Invalid mail batch review')
  const review = value as MailBatchReview
  if (!uuid.test(review.batchId) || !address.test(review.mailbox) || typeof review.phase !== 'string' || typeof review.baseline !== 'boolean' || !Array.isArray(review.items) || review.items.length > 100 || !Array.isArray(review.deliveries) || review.deliveries.length > 100 || !Array.isArray(review.effects) || review.effects.length > 1000) throw new Error('Invalid mail batch review')
  for (const item of review.items) {
    if (!item || [item.id, item.sender, item.subject, item.reason, item.disposition].some(value => typeof value !== 'string')) throw new Error('Invalid mail batch item')
  }
  for (const item of review.deliveries) {
    if (!item || typeof item.key !== 'string' || typeof item.body !== 'string' || item.body.length > 3500 || !['pending', 'confirmed', 'notApplied', 'unknown'].includes(item.state) || (item.messageId !== undefined && !Number.isSafeInteger(item.messageId))) throw new Error('Invalid mail delivery receipt')
  }
  for (const effect of review.effects) {
    if (!effect || typeof effect.key !== 'string' || !['mail.move', 'mail.telegram'].includes(effect.operation) || !uuid.test(effect.runId) || !uuid.test(effect.podId) || !['intent', 'unknown', 'completed', 'notApplied'].includes(effect.state)) throw new Error('Invalid mail effect review')
  }
  return review
}
