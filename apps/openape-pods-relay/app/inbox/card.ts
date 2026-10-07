import type { InboxItem } from './client'
import { t } from './i18n'

// The desktop lists an item's payload as `key: value` lines below one context line (network choices).
const fact = /^([a-z][\w.-]{0,40}): (.+)$/i

export interface CardSummary { sender: string | null, excerpt: string | null, hints: string[] }

/** What a card shows to decide at a glance: the sender first, then classification hints instead of the raw field list. */
export function cardSummary(item: InboxItem): CardSummary {
  const pairs = item.body.split('\n').flatMap((line) => {
    const match = fact.exec(line.trim())
    return match ? [[match[1]!.toLowerCase(), match[2]!.trim()] as const] : []
  })
  const facts = Object.fromEntries(pairs)
  // A field value can contain line breaks, so a second sender line may be forged: then no sender is promoted at all.
  const senders = pairs.filter(([key]) => key === 'sender' || key === 'from')
  const sender = senders.length === 1 ? senders[0]![1] : null
  if (!sender) return { sender: null, excerpt: item.body.length > 160 ? `${item.body.slice(0, 160).trimEnd()} …` : item.body || null, hints: [] }
  const confidence = Number(facts.confidence)
  const hints = [facts.category, Number.isFinite(confidence) && confidence >= 0 && confidence <= 1 ? t('cardConfidence', { value: Math.round(confidence * 100) }) : null].filter((hint): hint is string => !!hint)
  return { sender, excerpt: null, hints }
}
