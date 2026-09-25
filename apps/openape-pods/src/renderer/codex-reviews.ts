import { codexConversationId } from '../contracts/codex'
import type { MasterView } from '../contracts/master'

// The hidden Codex scope exists from Codex's first call on; before that
// nothing is prepared, which the worker reports as a missing conversation.
export async function loadCodexReviews(): Promise<MasterView | null> {
  try { return await window.pods.master({ type: 'list', conversationId: codexConversationId }) }
  catch (error) {
    if (error instanceof Error && error.message.includes('Conversation not found')) return null
    throw error
  }
}

export function pendingReviews(view: MasterView | null): number {
  return view ? (view.changes ?? []).filter(set => set.state === 'pending').length + view.proposals.filter(proposal => proposal.state === 'pending').length : 0
}
