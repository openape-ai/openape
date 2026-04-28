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
export interface BucketDisplay {
  /** Internal id used for keying. `'default'` is the wildcard catch-all. */
  id: AudienceBucket | 'default'
  label: string
  description: string
  /** Audience strings to PUT/DELETE per bucket toggle. */
  audiences: string[]
  icon: string
  accent: 'blue' | 'orange' | 'purple' | 'gray'
  /**
   * Placeholder for the deny-patterns textarea. Bucket-specific so users see
   * shape examples that fit the audience (bash for Commands, host glob for
   * Web, etc.) instead of bash patterns under a Web tab.
   */
  denyPatternPlaceholder: string
  /** Helper text displayed under the deny-patterns field. */
  denyPatternHelp: string
  /**
   * Optional notice rendered above the form (e.g. limitations, future work).
   *  Empty string = no banner.
   */
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
    denyPatternPlaceholder: 'rm -rf *\nsudo *\ncurl * | sh\ngit push --force *',
    denyPatternHelp: 'Bash-Glob-Pattern (eine pro Zeile). Match gegen den vollen Command-String. * = beliebige Zeichen, ? = ein Zeichen.',
  },
  {
    id: 'web',
    label: 'Web',
    description: 'Outbound Network-Egress über den OpenApe-Proxy (ape-proxy).',
    audiences: ['ape-proxy'],
    icon: 'i-lucide-globe',
    accent: 'orange',
    denyPatternPlaceholder: '*.openai.com\nstripe.com\n169.254.169.254\n*.evil.com',
    denyPatternHelp: 'Host-Glob (eine pro Zeile). Match gegen den Target-Host beim CONNECT. URL-Pfad + Methode sind heute nicht enforcebar (TLS-opaque). Method+Path-Patterns für cleartext-HTTP folgen in einer späteren Iteration.',
    notice: 'Heute matcht der Evaluator nur Hostname-Globs. URL+Method-Patterns für cleartext-HTTP sind in Arbeit.',
  },
  {
    id: 'root',
    label: 'Root',
    description: 'Privileg-Eskalation über escapes (sudo / root).',
    audiences: ['escapes'],
    icon: 'i-lucide-shield-alert',
    accent: 'purple',
    denyPatternPlaceholder: 'apt-get install *\nsystemctl stop *\nuserdel *',
    denyPatternHelp: 'Bash-Glob für root-Commands (eine pro Zeile). Wird nach escapes-Aufruf gegen den ausgeführten Command-String gematched.',
  },
  {
    id: 'default',
    label: 'Default',
    description: 'Wirkt für alle Audiences die keinen eigenen Bucket-Eintrag haben.',
    audiences: [AUDIENCE_WILDCARD],
    icon: 'i-lucide-asterisk',
    accent: 'gray',
    denyPatternPlaceholder: '*.openai.com\nrm -rf *',
    denyPatternHelp: 'Catch-all für Audiences ohne eigenen Bucket. Pattern-Shape je nachdem, welche Audience matched.',
  },
]
