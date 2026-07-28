// Device-credential source + short-lived troop-token mint for the nest
// daemon (M4δ-4). The nest is a *device* bound to an Owner, not a DDISA
// agent: it has no keypair and no IdP identity. Its only credential is
// the high-entropy `device_secret` the Owner minted at bind time
// (`ape-troop nests bind`) and injected here. On each (re)connect the
// daemon presents `{host_id, device_secret}` to POST /api/nests/token
// and gets a short-lived, nest:*-scoped troop token.
//
// The Owner injects the creds out-of-band — env vars (primary, for
// container injection) or a 0600 file. The secret lives on disk/env;
// the minted token is held in memory only (see troop-ws.ts), never
// persisted, and re-minted on restart.

import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { ofetch } from 'ofetch'

export interface NestDeviceCreds {
  hostId: string
  deviceSecret: string
}

// `OPENAPE_NEST_DEVICE_PATH` overrides the default file location, mirroring
// the registry's `OPENAPE_NEST_REGISTRY_PATH` convention.
function resolveDevicePath(): string {
  return process.env.OPENAPE_NEST_DEVICE_PATH ?? join(homedir(), 'nest-device.json')
}

// Env vars win over the file so a container can inject creds without a
// writable home. Returns null when neither source yields a usable pair —
// the daemon then fails closed (no IdP fallback; device identity is the
// only identity).
export function readDeviceCreds(): NestDeviceCreds | null {
  const envHost = process.env.OPENAPE_NEST_HOST_ID?.trim()
  const envSecret = process.env.OPENAPE_NEST_DEVICE_SECRET?.trim()
  if (envHost && envSecret) return { hostId: envHost, deviceSecret: envSecret }

  const path = resolveDevicePath()
  if (!existsSync(path)) return null
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as { host_id?: unknown, device_secret?: unknown }
    const hostId = typeof parsed.host_id === 'string' ? parsed.host_id.trim() : ''
    const deviceSecret = typeof parsed.device_secret === 'string' ? parsed.device_secret : ''
    if (!hostId || !deviceSecret) return null
    return { hostId, deviceSecret }
  }
  catch {
    return null
  }
}

// The WS URL (wss://troop.openape.ai) and the mint endpoint share a host
// but differ in scheme.
export function troopHttpUrl(troopWsUrl: string): string {
  return troopWsUrl.replace(/^wss:\/\//, 'https://').replace(/^ws:\/\//, 'http://')
}

export interface MintedToken {
  token: string
  /** Unix epoch *seconds* (matches the token's `exp`/`iat`). */
  expiresAt: number
}

// Exchange the device secret for a short-lived troop token. Throws on a
// non-2xx response (401 = bad secret or the nest was revoked); the caller
// logs and retries on the normal reconnect backoff.
export async function mintNestToken(troopWsUrl: string, creds: NestDeviceCreds): Promise<MintedToken> {
  const res = await ofetch<{ access_token: string, expires_at: number }>(
    `${troopHttpUrl(troopWsUrl)}/api/nests/token`,
    { method: 'POST', body: { host_id: creds.hostId, device_secret: creds.deviceSecret } },
  )
  return { token: res.access_token, expiresAt: res.expires_at }
}
