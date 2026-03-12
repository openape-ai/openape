import type { SPClientMetadata } from '../types/index.js'

export interface ManifestValidationResult {
  valid: boolean
  manifest?: SPClientMetadata
  errors: string[]
}

/**
 * Validate an SP Client Metadata object (RFC 7591).
 */
export function validateClientMetadata(data: unknown): ManifestValidationResult {
  const errors: string[] = []

  if (!data || typeof data !== 'object') {
    return { valid: false, errors: ['Client metadata must be an object'] }
  }

  const obj = data as Record<string, unknown>

  if (typeof obj.client_id !== 'string' || !obj.client_id) {
    errors.push('client_id is required and must be a non-empty string')
  }

  if (typeof obj.client_name !== 'string' || !obj.client_name) {
    errors.push('client_name is required and must be a non-empty string')
  }

  if (!Array.isArray(obj.redirect_uris) || obj.redirect_uris.length === 0) {
    errors.push('redirect_uris is required and must be a non-empty array')
  }
  else {
    for (const uri of obj.redirect_uris) {
      if (typeof uri !== 'string') {
        errors.push('Each redirect_uri must be a string')
        break
      }
      try {
        new URL(uri)
      }
      catch {
        errors.push(`Invalid redirect_uri: ${uri}`)
      }
    }
  }

  if (obj.contacts !== undefined && !Array.isArray(obj.contacts)) {
    errors.push('contacts must be an array if provided')
  }

  if (obj.jwks_uri !== undefined && typeof obj.jwks_uri !== 'string') {
    errors.push('jwks_uri must be a string if provided')
  }

  if (errors.length > 0) {
    return { valid: false, errors }
  }

  return {
    valid: true,
    manifest: obj as unknown as SPClientMetadata,
    errors: [],
  }
}

/**
 * Fetch and validate SP Client Metadata from a remote URL.
 */
export async function fetchAndValidateClientMetadata(
  metadataUrl: string,
): Promise<ManifestValidationResult> {
  try {
    const response = await fetch(metadataUrl)
    if (!response.ok) {
      return { valid: false, errors: [`Failed to fetch client metadata: HTTP ${response.status}`] }
    }
    const data = await response.json()
    return validateClientMetadata(data)
  }
  catch (err) {
    return {
      valid: false,
      errors: [err instanceof Error ? err.message : 'Failed to fetch client metadata'],
    }
  }
}
