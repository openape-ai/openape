import * as jose from 'jose'
import { ALGORITHM } from '../constants.js'

/**
 * Generate an EdDSA key pair for signing/verifying.
 */
export async function generateKeyPair(): Promise<jose.GenerateKeyPairResult> {
  return jose.generateKeyPair(ALGORITHM, { extractable: true })
}

/**
 * Sign a JWT with EdDSA.
 */
export async function signJWT(
  payload: jose.JWTPayload,
  privateKey: jose.CryptoKey | jose.KeyObject | Uint8Array,
  options?: { kid?: string },
): Promise<string> {
  const builder = new jose.SignJWT(payload)
    .setProtectedHeader({
      alg: ALGORITHM,
      typ: 'JWT',
      ...(options?.kid ? { kid: options.kid } : {}),
    })

  return builder.sign(privateKey)
}

/**
 * Verify a JWT with EdDSA.
 */
export async function verifyJWT<T = jose.JWTPayload>(
  token: string,
  keyOrJWKS: jose.CryptoKey | jose.KeyObject | Uint8Array | jose.JWTVerifyGetKey,
  options?: jose.JWTVerifyOptions,
): Promise<{ payload: T, protectedHeader: jose.JWTHeaderParameters }> {
  const verifyOptions = { algorithms: [ALGORITHM] as string[], ...options }

  // jose has separate overloads for key|Uint8Array vs GetKeyFunction
  const result = typeof keyOrJWKS === 'function'
    ? await jose.jwtVerify(token, keyOrJWKS as jose.JWTVerifyGetKey, verifyOptions)
    : await jose.jwtVerify(token, keyOrJWKS as jose.CryptoKey | jose.KeyObject | Uint8Array, verifyOptions)

  return result as { payload: T, protectedHeader: jose.JWTHeaderParameters }
}

/**
 * Create a JWKS fetch function for remote key resolution.
 */
export function createRemoteJWKS(jwksUri: string): jose.JWTVerifyGetKey {
  return jose.createRemoteJWKSet(new URL(jwksUri))
}

/**
 * Export a public key as JWK.
 */
export async function exportPublicKeyJWK(
  publicKey: jose.CryptoKey | jose.KeyObject,
  kid?: string,
): Promise<jose.JWK> {
  const jwk = await jose.exportJWK(publicKey)
  return {
    ...jwk,
    alg: ALGORITHM,
    use: 'sig',
    ...(kid ? { kid } : {}),
  }
}

/**
 * Import a JWK as a CryptoKey.
 */
export async function importJWK(jwk: jose.JWK): Promise<jose.CryptoKey | jose.KeyObject | Uint8Array> {
  return jose.importJWK(jwk, ALGORITHM)
}
