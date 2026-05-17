// Pending spawn-intent registry. A POST /api/agents/spawn-intent
// publishes the intent to a connected nest over the WS control-plane,
// then has to wait for the nest's `spawn-result` frame. The intent
// API returns immediately with an `intent_id` so the UI can poll
// (`/api/agents/spawn-intent/<id>`) rather than holding an HTTP
// connection open for the full DDISA-grant-approval window
// (potentially minutes).

export interface SpawnIntentResult {
  ok: boolean
  agentEmail?: string
  error?: string
  /** UNIX seconds */
  resolvedAt: number
}

interface PendingIntent {
  createdAt: number
  result?: SpawnIntentResult
}

const intents = new Map<string, PendingIntent>()

// Drop completed/abandoned intents after 30 min — owner long since
// gave up polling and the result becomes irrelevant. Prevents the
// map from growing unbounded over a long-running process.
const PRUNE_AFTER_S = 30 * 60

function prune(): void {
  const now = Math.floor(Date.now() / 1000)
  for (const [id, intent] of intents) {
    const reference = intent.result?.resolvedAt ?? intent.createdAt
    if (now - reference > PRUNE_AFTER_S) intents.delete(id)
  }
}

export function createSpawnIntent(id: string): void {
  prune()
  intents.set(id, { createdAt: Math.floor(Date.now() / 1000) })
}

export function resolveSpawnIntent(id: string, payload: Omit<SpawnIntentResult, 'resolvedAt'>): void {
  const intent = intents.get(id)
  if (!intent) return // intent never created (or already pruned) — drop
  intent.result = {
    ok: payload.ok,
    agentEmail: payload.agentEmail,
    error: payload.error,
    resolvedAt: Math.floor(Date.now() / 1000),
  }
}

export function getSpawnIntent(id: string): { result?: SpawnIntentResult, createdAt: number } | undefined {
  return intents.get(id)
}

// Test-only escape hatch — lets unit tests start each case from a
// known-clean registry without process restart. Unique name to
// avoid colliding with nest-registry.ts (Nuxt server auto-imports
// scan this directory and warn on duplicate exports).
export const _spawnIntentsInternal = { intents }
