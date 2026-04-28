/**
 * Client-side mirror of `server/utils/audience-buckets.ts`. Kept duplicated
 * (small, stable map) so client code doesn't need to cross the server boundary.
 * If the server-side registry grows, mirror the change here. The pre-approval
 * hook + grant evaluation never read from this file — only the UI does.
 */

export type AudienceBucket = 'commands' | 'web' | 'root' | 'other'

export const KNOWN_BUCKETS: Record<string, AudienceBucket> = {
  'ape-shell': 'commands',
  'claude-code': 'commands',
  'shapes': 'commands',
  'ape-proxy': 'web',
  'escapes': 'root',
}

export const AUDIENCE_WILDCARD = '*'

export function bucketFor(audience: string): AudienceBucket {
  return KNOWN_BUCKETS[audience] ?? 'other'
}

export function audiencesInBucket(bucket: AudienceBucket): string[] {
  return Object.entries(KNOWN_BUCKETS)
    .filter(([, b]) => b === bucket)
    .map(([a]) => a)
}

/**
 * Display metadata for the four sections rendered on the agent detail page.
 * The fourth `default` row covers the per-agent wildcard fallback (audience
 * `'*'`) — anything not matched by a bucket-specific row.
 */
/**
 * Per-row pattern shape:
 *   - 'command' → a single text field. Pattern stored as plain string.
 *   - 'method-url' → method dropdown + URL/host glob field. Pattern stored
 *     as `"<METHOD> <URL>"` (or just `"<URL>"` when method='*'), so today's
 *     host-only matcher still fires for method='*' rows. Method-specific
 *     rows are stored forward-compatibly for the upcoming proxy-side
 *     method+path enrichment (M3.5).
 */
export type BucketPatternShape = 'command' | 'method-url'

/** HTTP methods offered in the per-row Method dropdown for `method-url` shape. */
export const HTTP_METHODS = ['*', 'GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD'] as const
export type HttpMethodChoice = typeof HTTP_METHODS[number]

/**
 * Parse a stored pattern string into its UI representation.
 *
 * For `method-url` shape:
 *   - `"POST https://api.openai.com/v1/*"` → `{ method: 'POST', value: 'https://api.openai.com/v1/*' }`
 *   - `"api.openai.com"`                   → `{ method: '*',    value: 'api.openai.com' }`
 *
 * For `command` shape: always `{ method: '*', value: <whole string> }`.
 */
export function parsePattern(stored: string, shape: BucketPatternShape): { method: HttpMethodChoice, value: string } {
  if (shape === 'command') return { method: '*', value: stored }
  const m = stored.match(/^(GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD) (.*)$/)
  if (m) return { method: m[1] as HttpMethodChoice, value: m[2]! }
  return { method: '*', value: stored }
}

/**
 * Serialize a UI row back to a stored string. Method `'*'` is dropped from
 * the prefix so today's host-only matcher (which has no method-awareness)
 * still fires on the URL portion alone. Method-specific rows preserve the
 * `"METHOD URL"` shape forward-compat.
 */
export function serializePattern(method: HttpMethodChoice, value: string, shape: BucketPatternShape): string {
  const trimmed = value.trim()
  if (shape === 'command' || method === '*') return trimmed
  return `${method} ${trimmed}`
}

export interface BucketDisplay {
  /** Internal id used for keying. `'default'` is the wildcard catch-all. */
  id: AudienceBucket | 'default'
  label: string
  description: string
  /** Audience strings to PUT/DELETE per bucket toggle. */
  audiences: string[]
  icon: string
  accent: 'blue' | 'orange' | 'purple' | 'gray'
  /** Determines the per-row editor: free-form command vs structured method+URL. */
  patternShape: BucketPatternShape
  /** Placeholder for the URL/pattern field in a row. */
  patternPlaceholder: string
  /** Helper text displayed under the pattern editor. */
  patternHelp: string
  /** Optional notice rendered above the form (enforcement-coverage limits). */
  notice?: string
}

export const BUCKET_DISPLAY: readonly BucketDisplay[] = [
  {
    id: 'commands',
    label: 'Commands',
    description: 'Bash-Lines + Tool-Invocations (ape-shell, claude-code, shapes-CLI).',
    audiences: ['ape-shell', 'claude-code', 'shapes'],
    icon: 'i-lucide-terminal',
    accent: 'blue',
    patternShape: 'command',
    patternPlaceholder: 'rm -rf *',
    patternHelp: 'Bash-Glob-Pattern. Match gegen den vollen Command-String. * = beliebige Zeichen, ? = ein Zeichen.',
  },
  {
    id: 'web',
    label: 'Web',
    description: 'Outbound Network-Egress über den OpenApe-Proxy (ape-proxy).',
    audiences: ['ape-proxy'],
    icon: 'i-lucide-globe',
    accent: 'orange',
    patternShape: 'method-url',
    patternPlaceholder: '*.openai.com',
    patternHelp: 'Method + URL/Host-Glob pro Zeile. Method=ALL fügt nur den URL-Teil als Host-Glob ein und wirkt heute beim CONNECT. Spezifische Methoden (POST etc.) werden gespeichert, matchen aber erst sobald der Proxy bei cleartext-HTTP-Calls Method+Path mitgibt (geplant in M3.5).',
    notice: 'Heute matcht nur ALL-Methode (Host-Glob beim CONNECT). Method-spezifische Rows werden gespeichert, aber erst durch M3.5 (proxy-side method+path enrichment) live.',
  },
  {
    id: 'root',
    label: 'Root',
    description: 'Privileg-Eskalation über escapes (sudo / root).',
    audiences: ['escapes'],
    icon: 'i-lucide-shield-alert',
    accent: 'purple',
    patternShape: 'command',
    patternPlaceholder: 'apt-get install *',
    patternHelp: 'Bash-Glob für root-Commands. Match gegen den ausgeführten Command-String nach escapes-Aufruf.',
  },
  {
    id: 'default',
    label: 'Default',
    description: 'Wirkt für alle Audiences die keinen eigenen Bucket-Eintrag haben.',
    audiences: [AUDIENCE_WILDCARD],
    icon: 'i-lucide-asterisk',
    accent: 'gray',
    patternShape: 'command',
    patternPlaceholder: '*.openai.com',
    patternHelp: 'Catch-all-Pattern. Glob-Match gegen das jeweilige Target (Command-String oder Host).',
  },
]
