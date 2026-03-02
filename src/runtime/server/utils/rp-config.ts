import type { RPConfig } from '@openape/auth'
import { useRuntimeConfig, useEvent } from 'nitropack/runtime'

export function getRPConfig(): RPConfig {
  try {
    const event = useEvent()
    if (event?.context?.openapeRpConfig) {
      const tenant = event.context.openapeRpConfig as Partial<RPConfig>
      return {
        rpName: tenant.rpName || 'OpenAPE Identity Server',
        rpID: tenant.rpID || 'localhost',
        origin: tenant.origin || `https://${tenant.rpID}`,
        requireUserVerification: tenant.requireUserVerification ?? false,
        residentKey: tenant.residentKey || 'preferred',
        attestationType: tenant.attestationType || 'none',
      }
    }
  }
  catch {}

  const config = useRuntimeConfig()
  const idpConfig = (config.openapeIdp || {}) as Record<string, any>

  const rpName = idpConfig.rpName || 'OpenAPE Identity Server'
  const rpID = idpConfig.rpID || idpConfig.rpId || idpConfig.rpid || idpConfig.rPID || idpConfig.rp_id || 'localhost'
  const origin = idpConfig.rpOrigin || idpConfig.rporigin || `http://${rpID}:3000`
  if (rpID === 'localhost') {
    console.warn('[rp-config] rpID resolved to localhost! idpConfig keys:', Object.keys(idpConfig).filter(k => k.toLowerCase().includes('rp')), 'values:', JSON.stringify({ rpID: idpConfig.rpID, rpId: idpConfig.rpId, rpid: idpConfig.rpid }))
  }

  return {
    rpName,
    rpID,
    origin,
    requireUserVerification: idpConfig.requireUserVerification ?? false,
    residentKey: idpConfig.residentKey || 'preferred',
    attestationType: idpConfig.attestationType || 'none',
  }
}
