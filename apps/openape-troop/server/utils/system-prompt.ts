// The agent's effective system prompt = the recipe intent (or the
// owner-set base systemPrompt) plus an optional free-text
// `user_addendum` the owner can edit any time. It is appended at sync
// time, so changing it takes effect on the next run with no re-deploy
// (Agent Recipe M5). Kept tiny + pure so it is unit-testable and the
// /api/agents/me/tasks handler stays declarative.

export function composeSystemPrompt(base: string, addendum: string | null | undefined): string {
  const b = (base ?? '').trim()
  const a = (addendum ?? '').trim()
  if (!a) return b
  if (!b) return a
  return `${b}\n\n${a}`
}
