export interface ArchiveMail {
  id: string
  version: string
  folder: string
  internetMessageId: string
  sender: string
  subject: string
  receivedAt: string
  url: string
}
export interface ArchiveItem extends ArchiveMail { reason: string }
export interface ArchiveProposal { application: string, mailbox: string, items: { id: string, version: string, reason: string }[] }
export interface ArchiveManifest {
  version: 1
  id: string
  podId: string
  applicationId: string
  applicationHash: string
  mailbox: string
  expiresAt: number
  items: ArchiveItem[]
}
export interface ArchiveOutcome { id: string, state: 'archived' | 'skipped' | 'unknown', reason: string, receipt?: ArchiveMail }
export interface ArchiveRecord {
  manifest: ArchiveManifest
  state: 'preparing' | 'pending' | 'executing' | 'completed' | 'denied' | 'expired' | 'unknown'
  grantId?: string
  url?: string
  outcomes: ArchiveOutcome[]
  error?: string
}
export interface ArchiveView { id: string, mailbox: string, count: number, state: ArchiveRecord['state'], url?: string, outcomes: ArchiveOutcome[], error?: string }
const address = /^[^\s@]+@[^\s@][^\s.@]*\.[^\s@]+$/
export function parseArchiveProposal(value: unknown): ArchiveProposal {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid archive proposal')
  const item = value as ArchiveProposal
  if (Object.keys(item).some(key => !['application', 'mailbox', 'items'].includes(key)) || typeof item.application !== 'string' || !item.application || item.application.length > 100 || typeof item.mailbox !== 'string' || !address.test(item.mailbox) || item.mailbox.length > 320 || !Array.isArray(item.items) || !item.items.length || item.items.length > 30) throw new Error('Archive proposals require an assigned application, mailbox and 1–30 messages')
  for (const mail of item.items) {
    if (!mail || Object.keys(mail).some(key => !['id', 'version', 'reason'].includes(key)) || typeof mail.id !== 'string' || !mail.id || mail.id.length > 2048 || typeof mail.version !== 'string' || !mail.version || mail.version.length > 2048 || typeof mail.reason !== 'string' || !mail.reason.trim() || mail.reason.length > 500) throw new Error('Each archive proposal needs an exact message and reason')
  }
  if (new Set(item.items.map(mail => mail.id)).size !== item.items.length) throw new Error('Duplicate archive messages')
  return { application: item.application, mailbox: item.mailbox.toLowerCase(), items: item.items.map(mail => ({ id: mail.id, version: mail.version, reason: mail.reason.trim() })) }
}
export function parseArchiveMail(value: unknown): ArchiveMail {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid mail identity')
  const mail = value as ArchiveMail
  for (const field of ['id', 'version', 'folder', 'internetMessageId', 'sender', 'subject', 'receivedAt', 'url'] as const) {
    if (typeof mail[field] !== 'string' || mail[field].length > 2048 || (!mail[field] && field !== 'subject')) throw new Error('Incomplete provider mail identity')
  }
  const url = new URL(mail.url)
  if (!address.test(mail.sender) || !Number.isFinite(Date.parse(mail.receivedAt)) || url.protocol !== 'https:' || !['outlook.office.com', 'outlook.office365.com', 'outlook.live.com'].includes(url.hostname) || url.username || url.password) throw new Error('Invalid provider mail metadata or source link')
  return Object.fromEntries(['id', 'version', 'folder', 'internetMessageId', 'sender', 'subject', 'receivedAt', 'url'].map(key => [key, mail[key as keyof ArchiveMail]])) as unknown as ArchiveMail
}
export function sameArchiveMail(expected: ArchiveMail, actual: ArchiveMail): boolean {
  return ['id', 'version', 'folder', 'internetMessageId', 'sender', 'subject', 'receivedAt'].every(key => expected[key as keyof ArchiveMail] === actual[key as keyof ArchiveMail])
}
export function archiveCommand(manifest: ArchiveManifest): string[] { const { items, ...batch } = manifest; return ['pods-mail-archive', 'archive', JSON.stringify(batch), ...items.map(item => JSON.stringify(item))] }
export function archiveSummary(manifest: ArchiveManifest): string {
  const lines = [`${manifest.items.length} E-Mails archivieren`, `Postfach: ${manifest.mailbox}`, 'Aktion: Genau diese Nachrichten vom Posteingang ins Archiv verschieben.', `Gültig bis: ${new Date(manifest.expiresAt).toLocaleString('de-AT', { timeZone: 'Europe/Vienna' })} (Wien)`, 'Geänderte oder bereits verschobene Nachrichten werden übersprungen.', 'Die Prüfung erfolgt unmittelbar vor dem Verschieben; Microsoft garantiert keine atomare Versionsprüfung.', '']
  manifest.items.forEach((mail, index) => lines.push(`${index + 1}. ${mail.subject || '(Ohne Betreff)'}`, `Von: ${mail.sender}`, `Eingang: ${mail.receivedAt}`, `Grund: ${mail.reason}`, mail.url, ''))
  return lines.join('\n')
}
