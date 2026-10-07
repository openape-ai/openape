import type { Receipt } from './client'
import { t } from './i18n'

const errors: Record<string, Parameters<typeof t>[0]> = { decision_changed: 'errorChanged', decision_resolved: 'errorResolved', pod_offline: 'errorPodOffline', workspace_busy: 'errorBusy', workspace_revision_conflict: 'errorBusy', invalid_inbox_input: 'errorInput', network: 'errorNetwork' }

/** Known service codes in words; the desktop's own failure text stays as written. */
export function errorText(code: string | null): string {
  if (!code) return ''
  const key = errors[code]
  return key ? t(key) : /^[a-z_]+$/.test(code) ? t('errorGeneric', { code }) : code
}

/** What this phone's answer reached; accepted and started always say "not applied yet". */
export function receiptText(receipt: Receipt | undefined): string {
  if (!receipt) return ''
  const values = { option: receipt.title, error: errorText(receipt.error) }
  return { sending: t('receiptSending', values), unsent: t('receiptUnsent', values), refused: errorText(receipt.error), accepted: t('receiptAccepted', values), started: t('receiptStarted', values), applied: t('receiptApplied', values), failed: t('receiptFailed', values), unknown: t('receiptUnknown', values) }[receipt.state]
}
