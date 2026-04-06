import type { IdPConfig } from './config'

const IDP_SESSION_NAME = 'openape-idp'
const DEFAULT_SESSION_SECRET = 'default-secret-change-me-in-production!'

export function getSessionConfig(config: IdPConfig) {
  return {
    name: IDP_SESSION_NAME,
    password: config.sessionSecret || DEFAULT_SESSION_SECRET,
    cookie: {
      httpOnly: true,
      secure: config.issuer.startsWith('https://'),
      sameSite: 'lax' as const,
      maxAge: 60 * 60 * 24 * 7, // 7 days
    },
  }
}
