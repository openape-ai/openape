import { ref } from 'vue'

export interface ResolvedSlot {
  resource: string
  selector?: Record<string, string> | undefined
}

export interface ResolvedCommand {
  cli_id: string
  operation_id: string
  executable?: string
  synthetic?: boolean
  detail: {
    type: 'openape_cli'
    cli_id: string
    operation_id: string
    action: string
    risk: 'low' | 'medium' | 'high' | 'critical'
    resource_chain: ResolvedSlot[]
    permission: string
    display: string
    constraints?: { exact_command?: boolean }
  }
  commandArgv?: string[]
  bindings?: Record<string, string>
  executionContext?: Record<string, unknown>
}

/**
 * Client-side shape resolver with LRU-ish in-memory cache. Intended for the
 * Phase 5 scoped-command wizard where users type a sample argv and we parse
 * it via POST /api/shapes/resolve to produce typed slots.
 *
 * The cache is per-component lifecycle, so navigating away clears it. That
 * matches the wizard's session semantics and avoids leaking stale resolves
 * across different agents.
 */
export function useShapeResolver(opts: { maxCacheEntries?: number } = {}) {
  const maxEntries = opts.maxCacheEntries ?? 50
  // Insertion-ordered Map = cheap LRU: delete-then-set on hit.
  const cache = new Map<string, ResolvedCommand>()
  const loading = ref(false)
  const error = ref('')

  function keyFor(cliId: string, argv: string[]): string {
    return `${cliId}\u0001${argv.join('\u0001')}`
  }

  async function resolve(cliId: string, argv: string[]): Promise<ResolvedCommand> {
    const key = keyFor(cliId, argv)
    const hit = cache.get(key)
    if (hit) {
      cache.delete(key)
      cache.set(key, hit)
      return hit
    }
    loading.value = true
    error.value = ''
    try {
      const r = await ($fetch as any)('/api/shapes/resolve', {
        method: 'POST',
        body: { cli_id: cliId, argv },
      }) as ResolvedCommand
      cache.set(key, r)
      if (cache.size > maxEntries) {
        const oldest = cache.keys().next().value
        if (oldest !== undefined) cache.delete(oldest)
      }
      return r
    }
    catch (e: unknown) {
      const err = e as { data?: { detail?: string, title?: string } }
      error.value = err.data?.detail ?? err.data?.title ?? 'resolve failed'
      throw e
    }
    finally {
      loading.value = false
    }
  }

  function clearCache() {
    cache.clear()
  }

  return { resolve, clearCache, loading, error }
}
