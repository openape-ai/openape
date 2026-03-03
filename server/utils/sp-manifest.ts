import { createError } from 'h3'
import { WELL_KNOWN_SP_MANIFEST } from '@openape/core'

interface SpManifest {
  sp_id: string
  name?: string
  redirect_uris: string[]
}

const manifestCache = new Map<string, { manifest: SpManifest, fetchedAt: number }>()
const CACHE_TTL = 5 * 60 * 1000 // 5 minutes

export async function validateRedirectUri(spId: string, redirectUri: string): Promise<void> {
  const manifest = await fetchSpManifest(spId)

  if (manifest?.redirect_uris?.length) {
    if (!manifest.redirect_uris.includes(redirectUri)) {
      throw createError({ statusCode: 400, statusMessage: 'redirect_uri not allowed by SP manifest' })
    }
    return
  }

  // Fallback: redirect_uri origin must match sp_id
  const redirectOrigin = new URL(redirectUri).origin
  const expectedOrigin = spId.startsWith('http') ? new URL(spId).origin : `https://${spId}`
  if (redirectOrigin !== expectedOrigin) {
    throw createError({ statusCode: 400, statusMessage: 'redirect_uri origin does not match sp_id' })
  }
}

async function fetchSpManifest(spId: string): Promise<SpManifest | null> {
  const cached = manifestCache.get(spId)
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL) {
    return cached.manifest
  }

  const baseUrl = spId.startsWith('http') ? spId : `https://${spId}`
  const url = `${baseUrl}${WELL_KNOWN_SP_MANIFEST}`

  try {
    const response = await fetch(url, {
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(5000),
    })
    if (!response.ok) return null

    const manifest = await response.json() as SpManifest
    manifestCache.set(spId, { manifest, fetchedAt: Date.now() })
    return manifest
  }
  catch {
    return null
  }
}
