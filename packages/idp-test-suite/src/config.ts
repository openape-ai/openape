export interface IdPTestConfig {
  /** Base URL or a function returning the base URL (resolved at test time). */
  baseUrl: string | (() => string)
  managementToken: string
  skip?: string[] // suite names to skip: 'discovery', 'admin-users', 'ssh-keys', 'auth', 'session', 'oidc-flow', 'grants', 'delegations', 'security'
}

/** Resolved config where baseUrl is always a string. Used inside test functions. */
export interface ResolvedConfig {
  readonly baseUrl: string
  readonly managementToken: string
}

/** Create a proxy that lazily resolves baseUrl on every access. */
export function lazyConfig(config: IdPTestConfig): ResolvedConfig {
  return {
    get baseUrl() {
      return typeof config.baseUrl === 'function' ? config.baseUrl() : config.baseUrl
    },
    get managementToken() {
      return config.managementToken
    },
  }
}
