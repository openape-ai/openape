import type { OpenApeManifest } from '@openape/core'
import { validateOpenApeManifest } from '@openape/core'
import { useIdpStorage } from './storage'

const CACHE_TTL = 24 * 60 * 60 * 1000 // 24 hours
const CACHE_PREFIX = 'manifest:'

interface CachedManifest {
  manifest: OpenApeManifest
  fetchedAt: number
}

/**
 * Fetch and cache an SP's openape.json manifest.
 * Returns null if the manifest is unavailable or invalid.
 */
export async function fetchSpManifest(domain: string): Promise<OpenApeManifest | null> {
  const storage = useIdpStorage()
  const cacheKey = `${CACHE_PREFIX}${domain}`

  // Check cache
  const cached = await storage.getItem<CachedManifest>(cacheKey)
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL) {
    return cached.manifest
  }

  // Fetch from well-known URL
  const url = `https://${domain}/.well-known/openape.json`
  try {
    const response = await fetch(url)
    if (!response.ok) return null

    const data = await response.json()
    const result = validateOpenApeManifest(data)
    if (!result.valid || !result.manifest) return null

    // Cache the result
    await storage.setItem(cacheKey, {
      manifest: result.manifest,
      fetchedAt: Date.now(),
    })

    return result.manifest
  }
  catch {
    return null
  }
}
