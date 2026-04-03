import type { ResolverOptions } from '@openape/core'

export interface SPConfig {
  clientId: string
  redirectUri: string
  spName?: string
  resolverOptions?: ResolverOptions
  /** IdP base URL (for grant verification and other IdP API calls). */
  idpUrl?: string
}

export interface SPInstance {
  app: import('h3').App
}
