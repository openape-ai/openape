import type { OpenApeManifest } from '../types/index.js'

export interface OpenApeManifestValidationResult {
  valid: boolean
  manifest?: OpenApeManifest
  errors: string[]
}

const VALID_RISK_LEVELS = ['low', 'medium', 'high', 'critical']
const VALID_AUTH_METHODS = ['ddisa', 'oidc']

/**
 * Validate an openape.json manifest object.
 */
export function validateOpenApeManifest(data: unknown): OpenApeManifestValidationResult {
  const errors: string[] = []

  if (!data || typeof data !== 'object') {
    return { valid: false, errors: ['Manifest must be an object'] }
  }

  const obj = data as Record<string, unknown>

  // version (required)
  if (typeof obj.version !== 'string' || !obj.version) {
    errors.push('version is required and must be a non-empty string')
  }

  // service (required)
  if (!obj.service || typeof obj.service !== 'object') {
    errors.push('service is required and must be an object')
  }
  else {
    const svc = obj.service as Record<string, unknown>
    if (typeof svc.name !== 'string' || !svc.name) {
      errors.push('service.name is required and must be a non-empty string')
    }
    if (typeof svc.url !== 'string' || !svc.url) {
      errors.push('service.url is required and must be a non-empty string')
    }
  }

  // auth (optional)
  if (obj.auth !== undefined) {
    if (typeof obj.auth !== 'object' || obj.auth === null) {
      errors.push('auth must be an object if provided')
    }
    else {
      const auth = obj.auth as Record<string, unknown>
      if (!Array.isArray(auth.supported_methods) || auth.supported_methods.length === 0) {
        errors.push('auth.supported_methods is required and must be a non-empty array')
      }
      else {
        for (const m of auth.supported_methods) {
          if (!VALID_AUTH_METHODS.includes(m as string)) {
            errors.push(`auth.supported_methods: invalid method "${m}"`)
          }
        }
      }
    }
  }

  // scopes (optional) — must be an array of { id, description, grants?, risk?, ... }
  if (obj.scopes !== undefined) {
    if (!Array.isArray(obj.scopes)) {
      errors.push('scopes must be an array if provided')
    }
    else {
      for (let i = 0; i < obj.scopes.length; i++) {
        const scope = obj.scopes[i]
        if (!scope || typeof scope !== 'object') {
          errors.push(`scopes[${i}]: must be an object`)
          continue
        }
        const s = scope as Record<string, unknown>
        if (typeof s.id !== 'string' || !s.id) {
          errors.push(`scopes[${i}].id is required`)
        }
        if (typeof s.description !== 'string' || !s.description) {
          errors.push(`scopes[${i}].description is required`)
        }
        if (s.grants !== undefined) {
          if (!Array.isArray(s.grants) || s.grants.some(g => typeof g !== 'string')) {
            errors.push(`scopes[${i}].grants must be a string[] if provided`)
          }
        }
        if (s.risk !== undefined && !VALID_RISK_LEVELS.includes(s.risk as string)) {
          errors.push(`scopes[${i}].risk must be one of: ${VALID_RISK_LEVELS.join(', ')}`)
        }
      }
    }
  }

  // policies (optional)
  if (obj.policies !== undefined) {
    if (typeof obj.policies !== 'object' || obj.policies === null) {
      errors.push('policies must be an object if provided')
    }
    else {
      const p = obj.policies as Record<string, unknown>
      if (p.delegation !== undefined && !['allowed', 'denied'].includes(p.delegation as string)) {
        errors.push('policies.delegation must be "allowed" or "denied"')
      }
    }
  }

  if (errors.length > 0) {
    return { valid: false, errors }
  }

  return {
    valid: true,
    manifest: obj as unknown as OpenApeManifest,
    errors: [],
  }
}
