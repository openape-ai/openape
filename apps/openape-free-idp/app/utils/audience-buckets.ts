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
}

export const BUCKET_DISPLAY: readonly BucketDisplay[] = [
  {
    id: 'commands',
    label: 'Commands',
    description: 'Bash-Lines + Tool-Invocations (ape-shell, claude-code, shapes-CLI).',
    audiences: ['ape-shell', 'claude-code', 'shapes'],
    icon: 'i-lucide-terminal',
    accent: 'blue',
  },
  {
    id: 'web',
    label: 'Web',
    description: 'Outbound Network-Egress über den OpenApe-Proxy (ape-proxy).',
    audiences: ['ape-proxy'],
    icon: 'i-lucide-globe',
    accent: 'orange',
  },
  {
    id: 'root',
    label: 'Root-Commands',
    description: 'Privileg-Eskalation über escapes (sudo / root).',
    audiences: ['escapes'],
    icon: 'i-lucide-shield-alert',
    accent: 'purple',
  },
  {
    id: 'default',
    label: 'Default (Fallback)',
    description: 'Wirkt für alle Audiences die keinen eigenen Bucket-Eintrag haben.',
    audiences: [AUDIENCE_WILDCARD],
    icon: 'i-lucide-asterisk',
    accent: 'gray',
  },
]
