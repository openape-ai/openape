import type { ResolverOptions } from '@openape/core'

export interface SPConfig {
  clientId: string
  redirectUri: string
  spName?: string
  resolverOptions?: ResolverOptions
}

export interface SPInstance {
  app: import('h3').App
}
