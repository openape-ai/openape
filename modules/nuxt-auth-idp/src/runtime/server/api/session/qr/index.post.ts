import { defineEventHandler, getHeader, getRequestIP } from 'h3'
import { useGrantStorage } from '../../../utils/grant-storage'
import { hashClaimSecret, mintQrToken, QR_CHANNEL_TTL_MS, qrChannelKey } from '../../../utils/qr-login'
import type { QrChannel } from '../../../utils/qr-login'

// Deliberately unauthenticated: the caller is the browser that cannot sign
// in yet. It is the only holder of the claimSecret; the channel is worthless
// without it. Rate-limited in its own bucket (see plugins/rate-limit.ts).
export default defineEventHandler(async (event) => {
  const channelId = mintQrToken()
  const claimSecret = mintQrToken()

  // Shown to the human on the approve page — the only context they have to
  // recognize a QRLjacking attempt (a relayed code from a machine that is
  // not in front of them).
  const requester = {
    ip: getRequestIP(event, { xForwardedFor: true }) ?? 'unknown',
    userAgent: getHeader(event, 'user-agent') ?? 'unknown',
  }

  const channel: QrChannel = {
    state: 'pending',
    claimSecretHash: hashClaimSecret(claimSecret),
    requester,
    expiresAt: Date.now() + QR_CHANNEL_TTL_MS,
  }
  await useGrantStorage().setItem(qrChannelKey(channelId), channel)

  return { channelId, claimSecret, expiresIn: QR_CHANNEL_TTL_MS / 1000 }
})
