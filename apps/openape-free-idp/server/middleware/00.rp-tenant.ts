import { getRequestHost } from 'h3'
import { useRuntimeConfig } from '#imports'

// Derives per-request WebAuthn RP config from Host header so one instance
// can serve multiple origins (id.openape.ai + id.openape.at). Unknown hosts
// are ignored and fall through to the static rpID; this prevents a rogue
// Host header from binding credentials to an attacker-chosen RP.
export default defineEventHandler((event) => {
  const config = useRuntimeConfig()
  const idpCfg = (config.openapeIdp || {}) as Record<string, unknown>
  const raw = (idpCfg.rpHostAllowList as string | undefined) || 'id.openape.ai,id.openape.at'
  const allow = raw.split(',').map(s => s.trim()).filter(Boolean)

  const host = getRequestHost(event, { xForwardedHost: true })?.split(':')[0]
  if (!host || !allow.includes(host)) return

  event.context.openapeRpConfig = {
    rpName: (idpCfg.rpName as string | undefined) || 'OpenApe Identity Server',
    rpID: host,
    origin: `https://${host}`,
    requireUserVerification: idpCfg.requireUserVerification ?? false,
    residentKey: idpCfg.residentKey ?? 'preferred',
    attestationType: idpCfg.attestationType ?? 'none',
  }
})
