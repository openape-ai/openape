// Bearer-token auth for the Nest HTTP API. Same DDISA grant model
// as escapes-helper: caller obtains a grant from the IdP (via
// `apes nest spawn|destroy|list`), the IdP auto-approves under the
// nest's YOLO policy, the resulting authz_jwt is presented as Bearer.
//
// We verify against the IdP's JWKS rather than a shared secret —
// that lets cross-device callers (a future iPhone-Patrick) talk to
// any Nest without per-Nest credentials.

import { hostname } from 'node:os'
import { createRemoteJWKS, verifyJWT } from '@openape/core'
import type { OpenApeAuthZClaims } from '@openape/core'

export const NEST_AUDIENCE = 'nest'

const idpUrl = process.env.OPENAPE_IDP_URL ?? 'https://id.openape.ai'

let _jwks: ReturnType<typeof createRemoteJWKS> | null = null

function getJwks(): ReturnType<typeof createRemoteJWKS> {
  if (!_jwks) {
    const url = new URL('/.well-known/jwks.json', idpUrl).toString()
    _jwks = createRemoteJWKS(url)
  }
  return _jwks
}

export class NestAuthError extends Error {
  constructor(public status: number, public title: string) {
    super(title)
  }
}

export interface NestGrantContext {
  caller: string
  grantId: string
  command: string[]
}

/**
 * Verify a Bearer token presented to the Nest. Throws NestAuthError on
 * any failure. Returns the caller (sub claim) and the grant id.
 *
 * `expectedCommand` is the command-array the route corresponds to —
 * e.g. ['nest','list'] or ['nest','spawn','igor18']. Glob-matching is
 * NOT done here; YOLO already matched at grant-creation time. Here we
 * verify exact equality so a token granted for one command cannot be
 * replayed against another.
 */
export async function verifyNestGrant(
  token: string,
  expectedCommand: string[],
): Promise<NestGrantContext> {
  let claims: OpenApeAuthZClaims
  try {
    const result = await verifyJWT<OpenApeAuthZClaims>(token, getJwks(), {
      issuer: idpUrl,
      audience: NEST_AUDIENCE,
    })
    claims = result.payload
  }
  catch (err) {
    throw new NestAuthError(401, `Invalid or expired grant token: ${err instanceof Error ? err.message : String(err)}`)
  }

  if (typeof claims.sub !== 'string' || !claims.sub) {
    throw new NestAuthError(401, 'Grant token missing sub claim')
  }
  if (claims.target_host !== hostname()) {
    throw new NestAuthError(403, `Grant target_host (${claims.target_host}) does not match this nest (${hostname()})`)
  }

  const cmd = claims.command ?? []
  if (cmd.length !== expectedCommand.length || cmd.some((c, i) => c !== expectedCommand[i])) {
    throw new NestAuthError(
      403,
      `Grant command (${JSON.stringify(cmd)}) does not match this route (${JSON.stringify(expectedCommand)})`,
    )
  }

  return { caller: claims.sub, grantId: claims.grant_id, command: cmd }
}

/**
 * Warm the JWKS cache at startup so the first request doesn't pay the
 * JWKS fetch latency. Logs and swallows errors — a transient JWKS
 * outage shouldn't crash the daemon.
 */
export async function primeJwksCache(log: (line: string) => void): Promise<void> {
  try {
    // jose's RemoteJWKSet doesn't have an explicit prime; we trigger
    // it implicitly by attempting to verify a known-bad token. The
    // verify call will fetch JWKS, then fail signature (which is what
    // we want — we don't have a real token to test with). Catch and
    // ignore the verify error; only the network/JWKS errors bubble.
    await verifyJWT('eyJhbGciOiJFZERTQSJ9.e30.invalid', getJwks(), {})
      .catch(() => { /* signature mismatch is expected */ })
    log(`nest: JWKS primed from ${idpUrl}/.well-known/jwks.json`)
  }
  catch (err) {
    log(`nest: warning — JWKS prime failed: ${err instanceof Error ? err.message : String(err)}`)
  }
}
