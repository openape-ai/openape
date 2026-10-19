import type { InboxItem, Receipt } from './client'
import { t } from './i18n'

// `effect` decisions come only from desktops before issue 1518; they still need the repair prompt there.
export function needsRepair(item: InboxItem): boolean {
  return item.state === 'open' && item.kind === 'decision' && item.decision?.authority === 'pods' && ['work', 'effect', 'approval'].includes(item.decision.type)
}

export function repairTitle(item: InboxItem): string {
  return item.pod?.name ? t('repairPodTitle', { name: item.pod.name }) : t('repairTitle')
}

export function repairPrompt(item: InboxItem, receipt?: Receipt): string {
  const context = {
    inboxItemId: item.id,
    runtimeId: item.decision?.runtimeId,
    pod: item.pod && { id: item.pod.id, name: item.pod.name },
    runId: item.runId,
    decision: item.decision && { sourceId: item.decision.sourceId, type: item.decision.type, digest: item.decision.digest },
    inboxCreatedAt: new Date(item.created).toISOString(),
    title: item.title,
    details: item.body,
    receipt: receipt && { requestId: receipt.requestId, state: receipt.state, error: receipt.error },
  }
  return [t('repairPromptTask'), t('repairPromptInspect'), t('repairPromptReconcile'), t('repairPromptVerify'), t('repairPromptContext'), JSON.stringify(context, null, 2)].join('\n\n')
}
