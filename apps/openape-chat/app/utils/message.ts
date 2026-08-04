export interface ChatMessage {
  senderEmail: string
  createdAt: number
  editedAt: number | null
  streaming?: boolean
}

/**
 * The name to put on a message. DDISA agent addresses look like
 * `igor30-cb6bf26a+patrick+hofmann_eco@id.openape.ai` — only the agent name
 * belongs in the header chip. Everything else (humans, federated logins)
 * falls back to the local part.
 */
export function displayName(email: string): string {
  if (email.endsWith('@id.openape.ai') && email.includes('+')) {
    const local = email.split('+')[0]!
    const dash = local.lastIndexOf('-')
    return dash > 0 ? local.slice(0, dash) : local
  }
  return email.split('@')[0] ?? email
}

/** Grace window that swallows the stream-end PATCH landing right after the POST. */
const EDIT_GRACE_SECONDS = 2

/**
 * Whether to mark a message as edited. Without the grace window every agent
 * message would light up "(edited)" the moment streaming flips false, because
 * the stream-end PATCH lands milliseconds after the placeholder POST.
 */
export function showEdited(message: ChatMessage): boolean {
  if (message.streaming) return false
  if (!message.editedAt) return false
  return message.editedAt - message.createdAt > EDIT_GRACE_SECONDS
}
