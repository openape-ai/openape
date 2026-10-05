export interface PodDescription { text: string, state: 'pending' | 'running' | 'ready' | 'failed', error: string | null, revision: number, updatedAt: number | null }

export interface AdoptionPreview { hash: string, firstMessageId: string, lastMessageId: string, requests: { id: string, text: string }[], messageCount: number }

/** One line for lists: the first full sentence, otherwise the text cut at a word boundary. */
export function descriptionSummary(text: string): string {
  const line = text.replace(/\s+/g, ' ').trim()
  const sentence = /^.{39,159}?[.!?](?= |$)/.exec(line)?.[0]
  if (sentence) return sentence
  return line.length <= 160 ? line : `${line.slice(0, 159).replace(/ \S*$/, '')}…`
}
