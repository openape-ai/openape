import type { DDISARecord, ResolverOptions } from '../types/index.js'
import { DEFAULT_DNS_CACHE_TTL } from '../constants.js'
import { detectRuntime } from './detect.js'
import { parseDDISARecord } from './parser.js'
import { resolveTXT as resolveDoh } from './doh.js'

interface CacheEntry {
  record: DDISARecord
  expires: number
}

const cache = new Map<string, CacheEntry>()

async function resolveTXTRecords(domain: string, options?: ResolverOptions): Promise<string[]> {
  const runtime = detectRuntime()

  switch (runtime) {
    case 'node':
    case 'bun': {
      const { resolveTXT } = await import('./node.js')
      return resolveTXT(domain)
    }
    case 'deno':
    case 'edge':
    case 'browser':
      return resolveDoh(domain, options?.dohProvider)
    default:
      return resolveDoh(domain, options?.dohProvider)
  }
}

/**
 * Resolve DDISA record for a domain.
 * Supports mock records for testing.
 */
export async function resolveDDISA(
  domain: string,
  options?: ResolverOptions,
): Promise<DDISARecord | null> {
  // Mock mode for testing
  if (options?.mockRecords?.[domain]) {
    const mock = options.mockRecords[domain]
    return {
      ...mock,
      raw: `idp=${mock.idp}${mock.mode ? `; mode=${mock.mode}` : ''}`,
    }
  }

  // Check cache
  if (!options?.noCache) {
    const cached = cache.get(domain)
    if (cached && cached.expires > Date.now()) {
      return cached.record
    }
  }

  const records = await resolveTXTRecords(domain, options)

  for (const record of records) {
    if (record.includes('idp=')) {
      const parsed = parseDDISARecord(record)
      if (parsed) {
        const ttl = options?.cacheTTL ?? DEFAULT_DNS_CACHE_TTL
        cache.set(domain, {
          record: parsed,
          expires: Date.now() + ttl * 1000,
        })
        return parsed
      }
    }
  }

  return null
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
