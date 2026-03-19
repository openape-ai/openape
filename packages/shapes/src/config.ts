import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

interface AuthData {
  idp: string
  access_token: string
  email: string
  expires_at: number
}

const GRAPES_AUTH_FILE = join(homedir(), '.config', 'grapes', 'auth.json')

export function loadAuth(): AuthData | null {
  if (!existsSync(GRAPES_AUTH_FILE))
    return null

  try {
    return JSON.parse(readFileSync(GRAPES_AUTH_FILE, 'utf-8')) as AuthData
  }
  catch {
    return null
  }
}

export function getIdpUrl(explicit?: string): string | null {
  if (explicit)
    return explicit
  if (process.env.SHAPES_IDP)
    return process.env.SHAPES_IDP
  if (process.env.GRAPES_IDP)
    return process.env.GRAPES_IDP
  return loadAuth()?.idp ?? null
}

export function getAuthToken(): string | null {
  const auth = loadAuth()
  if (!auth)
    return null
  if (auth.expires_at && Date.now() / 1000 > auth.expires_at - 30)
    return null
  return auth.access_token
}

export function getRequesterIdentity(): string | null {
  return loadAuth()?.email ?? null
}
