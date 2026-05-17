// Pending destroy-intent registry. Mirrors spawn-intents.ts but for
// the destroy side: a DELETE /api/agents/:name publishes the intent
// to the owner's connected nest over the WS control-plane, then has
// to wait for the nest's `destroy-result` frame. The intent API
// returns immediately with an `intent_id` so the UI can poll
// (`/api/agents/destroy-intent/<id>`) rather than holding an HTTP
// connection open for the full DDISA-grant-approval window.

export interface DestroyIntentResult {
  ok: boolean
  error?: string
  /** UNIX seconds */
  resolvedAt: number
}

interface PendingIntent {
  createdAt: number
  result?: DestroyIntentResult
}

const intents = new Map<string, PendingIntent>()

// Drop completed/abandoned intents after 30 min — same TTL as
// spawn-intents. Keeps the map bounded over a long-running process.
const PRUNE_AFTER_S = 30 * 60

function prune(): void {
  const now = Math.floor(Date.now() / 1000)
  for (const [id, intent] of intents) {
    const reference = intent.result?.resolvedAt ?? intent.createdAt
    if (now - reference > PRUNE_AFTER_S) intents.delete(id)
  }
}

export function createDestroyIntent(id: string): void {
  prune()
  intents.set(id, { createdAt: Math.floor(Date.now() / 1000) })
}

export function resolveDestroyIntent(id: string, payload: Omit<DestroyIntentResult, 'resolvedAt'>): void {
  const intent = intents.get(id)
  if (!intent) return
  intent.result = {
    ok: payload.ok,
    error: payload.error,
    resolvedAt: Math.floor(Date.now() / 1000),
  }
}

export function getDestroyIntent(id: string): { result?: DestroyIntentResult, createdAt: number } | undefined {
  return intents.get(id)
}

// Test-only escape hatch — same pattern as spawn-intents' export.
export const _destroyIntentsInternal = { intents }
