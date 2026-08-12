import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'

// QR sign-in: a browser that cannot do WebAuthn (public computer, kiosk)
// opens a channel and shows its id as a QR code; a signed-in phone scans,
// reviews the requester and approves; the kiosk claims the session.
//
// Two tokens, deliberately: the channelId travels in the QR (anyone who can
// see the screen can read it), the claimSecret never leaves the kiosk
// browser. Photographing the QR therefore yields nothing claimable.

export const QR_CHANNEL_TTL_MS = 120_000
export const QR_SESSION_TTL_MS = 60 * 60 * 1000

export interface QrRequester {
  ip: string
  userAgent: string
}

export interface QrChannel {
  state: 'pending' | 'approved'
  claimSecretHash: string
  requester: QrRequester
  session?: Record<string, unknown>
  expiresAt: number
}

// Written on claim; its continued existence is what keeps the transferred
// session alive, so deleting it from any signed-in device revokes the kiosk.
export interface QrSession {
  userId: string
  requester: QrRequester
  createdAt: number
  expiresAt: number
}

// Tokens are storage-key material; only the shape we mint may reach unstorage.
export const QR_TOKEN_RE = /^[a-f0-9]{64}$/

export function qrChannelKey(id: string) {
  return `qr-login:${id}`
}

export function qrSessionKey(id: string) {
  return `qr-session:${id}`
}

export function mintQrToken() {
  return randomBytes(32).toString('hex')
}

export function hashClaimSecret(secret: string) {
  return createHash('sha256').update(secret).digest('hex')
}

export function claimSecretMatches(secret: string, storedHash: string) {
  return timingSafeEqual(
    Buffer.from(hashClaimSecret(secret), 'hex'),
    Buffer.from(storedHash, 'hex'),
  )
}
