import type { DDISARecord, ResolverOptions } from '../types/index.js'
import { DEFAULT_DNS_CACHE_TTL, DEFAULT_DNS_NEGATIVE_CACHE_TTL } from '../constants.js'
import { resolveTXT as resolveDoh } from './doh.js'
import { parseDDISARecord } from './parser.js'

interface CacheEntry {
  record: DDISARecord | null
  expires: number
}

const cache = new Map<string, CacheEntry>()

/**
 * Resolve TXT records using native Node.js DNS with DoH fallback.
 *
 * Design decision: We always try native DNS first because it respects the
 * system's DNS configuration (/etc/hosts, local resolvers, split-horizon DNS).
 * This is essential for local development and testing with custom domains.
 *
 * If native DNS is unavailable (Edge runtimes, browsers, Deno) the dynamic
 * import of node:dns/promises fails and we fall back to DNS-over-HTTPS.
 * This makes the resolver work in every JavaScript runtime without explicit
 * runtime detection — the try/catch is the detection.
 */
async function resolveTXTRecords(domain: string, options?: ResolverOptions): Promise<string[]> {
  try {
    const { resolveTXT } = await import('./node.js')
    return await resolveTXT(domain)
  }
  catch {
    return resolveDoh(domain, options?.dohProvider)
  }
}

/** DDISA DNS subdomain prefix per spec */
const DDISA_PREFIX = '_ddisa.'

/**
 * Resolve DDISA record for a domain.
 * Queries `_ddisa.{domain}` TXT records per the DDISA specification.
 * Supports mock records for testing (keyed by bare domain).
 */
export async function resolveDDISA(
  domain: string,
  options?: ResolverOptions,
): Promise<DDISARecord | null> {
  // Env-based mock mode for E2E testing (no options passthrough needed)
  if (typeof process !== 'undefined' && process.env.DDISA_MOCK_RECORDS) {
    try {
      const envMocks = JSON.parse(process.env.DDISA_MOCK_RECORDS)
      if (envMocks[domain]) {
        const mock = envMocks[domain]
        return {
          version: 'ddisa1',
          idp: mock.idp,
          mode: mock.mode,
          raw: `v=ddisa1 idp=${mock.idp}${mock.mode ? `; mode=${mock.mode}` : ''}`,
        }
      }
    }
    catch { /* invalid JSON — fall through */ }
  }

  // Mock mode for testing (keyed by bare domain for convenience)
  if (options?.mockRecords?.[domain]) {
    const mock = options.mockRecords[domain]
    return {
      ...mock,
      version: mock.version ?? 'ddisa1',
      raw: `v=ddisa1 idp=${mock.idp}${mock.mode ? `; mode=${mock.mode}` : ''}`,
    }
  }

  // Check cache (keyed by bare domain)
  if (!options?.noCache) {
    const cached = cache.get(domain)
    if (cached && cached.expires > Date.now()) {
      return cached.record
    }
  }

  // Query _ddisa.{domain} per spec
  const ddisaDomain = `${DDISA_PREFIX}${domain}`
  const records = await resolveTXTRecords(ddisaDomain, options)

  // Parse all valid DDISA records and pick the one with lowest priority
  const parsed: DDISARecord[] = []
  for (const record of records) {
    if (record.includes('v=ddisa1')) {
      const result = parseDDISARecord(record)
      if (result) {
        parsed.push(result)
      }
    }
  }

  // Cache negative results too (#306). Without this, every authorize
  // for a user from a non-DDISA domain re-queries DNS — wasted
  // latency on the happy path and a DoS vector via crafted
  // login_hints. Note this only fires when `resolveTXTRecords`
  // returned successfully (possibly empty); transient errors
  // propagate up and are NOT cached so the next call retries.
  if (parsed.length === 0) {
    const negTtl = options?.negativeCacheTTL ?? DEFAULT_DNS_NEGATIVE_CACHE_TTL
    cache.set(domain, {
      record: null,
      expires: Date.now() + negTtl * 1000,
    })
    return null
  }

  // Sort by priority (lowest = highest priority, like MX). Default priority = 10.
  parsed.sort((a, b) => (a.priority ?? 10) - (b.priority ?? 10))
  const best = parsed[0]!

  const ttl = options?.cacheTTL ?? DEFAULT_DNS_CACHE_TTL
  cache.set(domain, {
    record: best,
    expires: Date.now() + ttl * 1000,
  })
  return best
}

/**
 * Resolve just the IdP URL for a domain.
 */
export async function resolveIdP(
  domain: string,
  options?: ResolverOptions,
): Promise<string | null> {
  const record = await resolveDDISA(domain, options)
  return record?.idp ?? null
}

/**
 * Clear the DNS cache.
 */
export function clearDNSCache(): void {
  cache.clear()
}
