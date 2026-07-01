import type { CodexCredential } from './codex-credential'

// Model discovery against the same private Codex backend the Responses endpoint
// uses. Lets agents list what they can target via `GET /v1/models`.
// Shape + fallback ported from NousResearch/hermes-agent `codex_models.py`.

const CODEX_MODELS_URL = 'https://chatgpt.com/backend-api/codex/models?client_version=1.0.0'

// Known-good current models, served when the live endpoint is unreachable or
// empty so discovery never hands back an empty list. gpt-5.5 is current.
export const FALLBACK_CODEX_MODELS: readonly string[] = [
  'gpt-5.5',
  'gpt-5.4-mini',
  'gpt-5.4',
  'gpt-5.3-codex',
  'gpt-5.3-codex-spark',
]

const HIDDEN_VISIBILITIES = new Set(['hide', 'hidden'])
const DEFAULT_PRIORITY = 10_000

interface RawCodexModel {
  slug?: unknown
  visibility?: unknown
  priority?: unknown
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/**
 * Extract visible model slugs from a raw `/codex/models` payload, sorted by
 * priority (ascending, default 10000) then slug. Returns `[]` for anything
 * unparseable — the caller decides whether to fall back.
 */
export function parseCodexModels(payload: unknown): string[] {
  if (!isObject(payload) || !Array.isArray(payload.models))
    return []

  const visible = payload.models
    .filter((m): m is RawCodexModel => isObject(m))
    .filter(m => typeof m.slug === 'string' && !HIDDEN_VISIBILITIES.has(String(m.visibility)))
    .map(m => ({ slug: m.slug as string, priority: typeof m.priority === 'number' ? m.priority : DEFAULT_PRIORITY }))
    .sort((a, b) => a.priority - b.priority || a.slug.localeCompare(b.slug))

  return [...new Set(visible.map(m => m.slug))]
}

interface ModelsFetchResponse {
  ok: boolean
  status: number
  json: () => Promise<unknown>
}
type ModelsFetchLike = (url: string, init: { headers: Record<string, string> }) => Promise<ModelsFetchResponse>

/**
 * Fetch the current Codex model slugs. Always resolves to a usable list:
 * on any HTTP/parse failure or an empty live list it degrades to
 * {@link FALLBACK_CODEX_MODELS}, logging the reason so the fallback is visible
 * in the service journal rather than silent.
 */
export async function fetchCodexModels(cred: CodexCredential, fetchImpl: ModelsFetchLike = fetch): Promise<string[]> {
  try {
    const res = await fetchImpl(CODEX_MODELS_URL, {
      headers: { authorization: `Bearer ${cred.access_token}`, 'chatgpt-account-id': cred.account_id },
    })
    if (!res.ok)
      throw new Error(`codex models HTTP ${res.status}`)
    const slugs = parseCodexModels(await res.json())
    if (slugs.length === 0)
      throw new Error('codex models response had no visible models')
    return slugs
  }
  catch (e) {
    console.warn(`[codex-proxy] /codex/models unavailable, using fallback list: ${e instanceof Error ? e.message : String(e)}`)
    return [...FALLBACK_CODEX_MODELS]
  }
}
