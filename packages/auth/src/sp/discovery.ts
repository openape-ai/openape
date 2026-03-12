import type { DDISARecord, ResolverOptions } from '@openape/core'
import { extractDomain, resolveDDISA } from '@openape/core'

export interface IdPConfig {
  idpUrl: string
  mode?: string
  record: DDISARecord
}

/**
 * Discover the IdP for a given email address.
 */
export async function discoverIdP(
  email: string,
  options?: ResolverOptions & { fallbackIdpUrl?: string },
): Promise<IdPConfig | null> {
  const domain = extractDomain(email)
  const record = await resolveDDISA(domain, options)

  if (!record && options?.fallbackIdpUrl) {
    return {
      idpUrl: options.fallbackIdpUrl,
      record: {
        version: 'ddisa1',
        idp: options.fallbackIdpUrl,
        raw: `v=ddisa1 idp=${options.fallbackIdpUrl}`,
      },
    }
  }

  if (!record)
    return null

  return {
    idpUrl: record.idp,
    mode: record.mode,
    record,
  }
}
