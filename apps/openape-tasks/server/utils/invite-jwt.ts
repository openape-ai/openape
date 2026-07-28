import { SignJWT, jwtVerify } from 'jose'
import { useRuntimeConfig } from 'nitropack/runtime'

export interface InvitePayload {
  iss: 'tasks.openape.ai'
  typ: 'team-invite'
  kid: string
  tid: string
  inv: string
  iat: number
  exp: number
}

function secret(): Uint8Array {
  const s = useRuntimeConfig().inviteSecret as string
  if (!s || s.length < 32) throw new Error('inviteSecret must be at least 32 chars')
  return new TextEncoder().encode(s)
}

export async function signInviteToken(
  params: { inviteId: string, teamId: string, inviterEmail: string, expiresAt: number },
): Promise<string> {
  const payload = {
    typ: 'team-invite',
    kid: params.inviteId,
    tid: params.teamId,
    inv: params.inviterEmail,
  } satisfies Omit<InvitePayload, 'iss' | 'iat' | 'exp'>

  return await new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuer('tasks.openape.ai')
    .setIssuedAt()
    .setExpirationTime(params.expiresAt)
    .sign(secret())
}

export async function verifyInviteToken(token: string): Promise<InvitePayload | null> {
  try {
    const { payload } = await jwtVerify(token, secret(), {
      issuer: 'tasks.openape.ai',
    })
    if (payload.typ !== 'team-invite') return null
    if (typeof payload.kid !== 'string' || typeof payload.tid !== 'string' || typeof payload.inv !== 'string') {
      return null
    }
    return payload as unknown as InvitePayload
  }
  catch {
    return null
  }
}

export function parseDuration(input: string | undefined, defaultHours: number): number {
  const fallback = defaultHours * 3600
  if (!input) return fallback
  const m = /^(\d+)(d|h|m)?$/.exec(input.trim())
  if (!m) return fallback
  const n = parseInt(m[1]!, 10)
  const unit = m[2] ?? 'h'
  if (unit === 'd') return n * 86400
  if (unit === 'h') return n * 3600
  if (unit === 'm') return n * 60
  return fallback
}
