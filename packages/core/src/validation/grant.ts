import type { KeyLike } from 'jose'
import type { OpenApeAuthZClaims } from '../types/index.js'
import { createRemoteJWKS, verifyJWT } from '../crypto/jwt.js'

export interface GrantValidationOptions {
  /** Expected issuer (OpenApe server) */
  expectedIss: string
  /** Expected audience (service identifier) */
  expectedAud: string
  /** JWKS URI for the OpenApe server */
  jwksUri?: string
  /** Public key for verification */
  publicKey?: KeyLike | Uint8Array
  /** Required permission to check */
  requiredPermission?: string
  /** Expected command hash */
  expectedCmdHash?: string
}

export interface GrantValidationResult {
  valid: boolean
  claims?: OpenApeAuthZClaims
  error?: string
}

/**
 * Validate a OpenApe AuthZ-JWT.
 */
export async function validateAuthzJWT(
  token: string,
  options: GrantValidationOptions,
): Promise<GrantValidationResult> {
  try {
    const verifyKey = options.publicKey
      ?? (options.jwksUri ? createRemoteJWKS(options.jwksUri) : undefined)

    if (!verifyKey) {
      return { valid: false, error: 'No verification key or JWKS URI provided' }
    }

    const { payload } = await verifyJWT<OpenApeAuthZClaims>(token, verifyKey, {
      issuer: options.expectedIss,
      audience: options.expectedAud,
    })

    // Check required permission
    if (options.requiredPermission && payload.permissions) {
      if (!payload.permissions.includes(options.requiredPermission)) {
        return { valid: false, error: `Missing required permission: ${options.requiredPermission}` }
      }
    }

    // Check command hash
    if (options.expectedCmdHash && payload.cmd_hash !== options.expectedCmdHash) {
      return { valid: false, error: 'Command hash mismatch' }
    }

    return { valid: true, claims: payload }
  }
  catch (err) {
    return { valid: false, error: err instanceof Error ? err.message : 'Validation failed' }
  }
}

/**
 * Compute SHA-256 hash of a command string for cmd_hash binding.
 */
export async function computeCmdHash(command: string): Promise<string> {
  const encoder = new TextEncoder()
  const data = encoder.encode(command)
  const hashBuffer = await crypto.subtle.digest('SHA-256', data)
  const hashArray = new Uint8Array(hashBuffer)
  return Array.from(hashArray).map(b => b.toString(16).padStart(2, '0')).join('')
}
