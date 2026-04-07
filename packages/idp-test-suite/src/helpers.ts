import type { KeyObject } from 'node:crypto'
import { generateKeyPairSync, sign } from 'node:crypto'

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

export async function post(
  baseUrl: string,
  path: string,
  body: unknown,
  auth?: string,
): Promise<{ status: number, data: any, headers: Headers }> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (auth)
    headers.Authorization = `Bearer ${auth}`

  const res = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  })

  const text = await res.text()
  let data: any
  try {
    data = JSON.parse(text)
  }
  catch {
    data = text
  }

  return { status: res.status, data, headers: res.headers }
}

export async function get(
  baseUrl: string,
  path: string,
  auth?: string,
): Promise<{ status: number, data: any, headers: Headers }> {
  const headers: Record<string, string> = {}
  if (auth)
    headers.Authorization = `Bearer ${auth}`

  const res = await fetch(`${baseUrl}${path}`, { headers })

  const text = await res.text()
  let data: any
  try {
    data = JSON.parse(text)
  }
  catch {
    data = text
  }

  return { status: res.status, data, headers: res.headers }
}

export async function del(
  baseUrl: string,
  path: string,
  auth?: string,
): Promise<{ status: number, data: any, headers: Headers }> {
  const headers: Record<string, string> = {}
  if (auth)
    headers.Authorization = `Bearer ${auth}`

  const res = await fetch(`${baseUrl}${path}`, { method: 'DELETE', headers })

  const text = await res.text()
  let data: any
  try {
    data = JSON.parse(text)
  }
  catch {
    data = text
  }

  return { status: res.status, data, headers: res.headers }
}

export async function fetchRaw(
  url: string,
  opts?: RequestInit & { cookies?: string },
): Promise<{ status: number, data: any, headers: Headers }> {
  const headers: Record<string, string> = { ...(opts?.headers as Record<string, string> ?? {}) }
  if (opts?.cookies)
    headers.Cookie = opts.cookies

  const res = await fetch(url, { ...opts, headers, redirect: opts?.redirect ?? 'follow' })

  const text = await res.text()
  let data: any
  try {
    data = JSON.parse(text)
  }
  catch {
    data = text
  }

  return { status: res.status, data, headers: res.headers }
}

// ---------------------------------------------------------------------------
// Crypto helpers
// ---------------------------------------------------------------------------

export function generateEd25519Key(): { publicKeySsh: string, privateKey: KeyObject } {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519')
  const rawPub = publicKey.export({ type: 'spki', format: 'der' })
  const rawKey = rawPub.subarray(12)

  const typeStr = 'ssh-ed25519'
  const typeBuf = Buffer.from(typeStr)
  const typeLen = Buffer.alloc(4)
  typeLen.writeUInt32BE(typeBuf.length)
  const keyLen = Buffer.alloc(4)
  keyLen.writeUInt32BE(rawKey.length)
  const wireFormat = Buffer.concat([typeLen, typeBuf, keyLen, rawKey])

  return {
    publicKeySsh: `ssh-ed25519 ${wireFormat.toString('base64')}`,
    privateKey,
  }
}

export function signChallenge(challenge: string, privateKey: KeyObject): string {
  const sig = sign(null, Buffer.from(challenge), privateKey)
  return sig.toString('base64')
}

// ---------------------------------------------------------------------------
// Auth flow helpers
// ---------------------------------------------------------------------------

export async function loginWithKey(
  baseUrl: string,
  email: string,
  privateKey: KeyObject,
): Promise<string> {
  const { data: challengeData } = await post(baseUrl, '/api/auth/challenge', { id: email })
  const signature = signChallenge(challengeData.challenge, privateKey)
  const { data: authData } = await post(baseUrl, '/api/auth/authenticate', {
    id: email,
    challenge: challengeData.challenge,
    signature,
  })
  return authData.token
}

export async function sessionLogin(
  baseUrl: string,
  email: string,
  privateKey: KeyObject,
): Promise<string[]> {
  const { data: challengeData } = await post(baseUrl, '/api/auth/challenge', { id: email })
  const signature = signChallenge(challengeData.challenge, privateKey)

  const res = await fetch(`${baseUrl}/api/session/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      id: email,
      challenge: challengeData.challenge,
      signature,
    }),
  })

  return res.headers.getSetCookie()
}

// ---------------------------------------------------------------------------
// Cookie jar
// ---------------------------------------------------------------------------

export class CookieJar {
  private store = new Map<string, Map<string, string>>()

  capture(url: string, setCookieHeaders: string[]): void {
    const origin = new URL(url).origin
    if (!setCookieHeaders.length)
      return

    let originJar = this.store.get(origin)
    if (!originJar) {
      originJar = new Map()
      this.store.set(origin, originJar)
    }

    for (const cookie of setCookieHeaders) {
      const [nameValue] = cookie.split(';')
      const eqIndex = nameValue!.indexOf('=')
      if (eqIndex === -1)
        continue
      const name = nameValue!.slice(0, eqIndex).trim()
      const value = nameValue!.slice(eqIndex + 1).trim()
      originJar.set(name, value)
    }
  }

  headerFor(url: string): string | undefined {
    const origin = new URL(url).origin
    const originJar = this.store.get(origin)
    if (!originJar || originJar.size === 0)
      return undefined
    return Array.from(originJar.entries())
      .map(([name, value]) => `${name}=${value}`)
      .join('; ')
  }

  clear(): void {
    this.store.clear()
  }
}
