import type { SPManifest } from '../types/index.js'

export interface ManifestValidationResult {
  valid: boolean
  manifest?: SPManifest
  errors: string[]
}

/**
 * Validate an SP Manifest object.
 */
export function validateSPManifest(data: unknown): ManifestValidationResult {
  const errors: string[] = []

  if (!data || typeof data !== 'object') {
    return { valid: false, errors: ['Manifest must be an object'] }
  }

  const obj = data as Record<string, unknown>

  if (typeof obj.sp_id !== 'string' || !obj.sp_id) {
    errors.push('sp_id is required and must be a non-empty string')
  }

  if (typeof obj.name !== 'string' || !obj.name) {
    errors.push('name is required and must be a non-empty string')
  }

  if (!Array.isArray(obj.redirect_uris) || obj.redirect_uris.length === 0) {
    errors.push('redirect_uris is required and must be a non-empty array')
  } else {
    for (const uri of obj.redirect_uris) {
      if (typeof uri !== 'string') {
        errors.push('Each redirect_uri must be a string')
        break
      }
      try {
        new URL(uri)
      } catch {
        errors.push(`Invalid redirect_uri: ${uri}`)
      }
    }
  }

  if (obj.jwks_uri !== undefined && typeof obj.jwks_uri !== 'string') {
    errors.push('jwks_uri must be a string if provided')
  }

  if (errors.length > 0) {
    return { valid: false, errors }
  }

  return {
    valid: true,
    manifest: obj as unknown as SPManifest,
    errors: [],
  }
}

/**
 * Fetch and validate an SP Manifest from a remote URL.
 */
export async function fetchAndValidateSPManifest(
  spManifestUrl: string,
): Promise<ManifestValidationResult> {
  try {
    const response = await fetch(spManifestUrl)
    if (!response.ok) {
      return { valid: false, errors: [`Failed to fetch manifest: HTTP ${response.status}`] }
    }
    const data = await response.json()
    return validateSPManifest(data)
  } catch (err) {
    return {
      valid: false,
      errors: [err instanceof Error ? err.message : 'Failed to fetch manifest'],
    }
  }
}
