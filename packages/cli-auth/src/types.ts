/**
 * IdP-issued auth credentials, stored at `~/.config/apes/auth.json`. Same
 * shape as `@openape/apes`'s internal AuthData — both packages cooperate on
 * this file. The CLI commands in `apes` write here on `apes login`; this
 * package reads here on every `getAuthorizedBearer` call.
 */
export interface IdpAuth {
  idp: string
  access_token: string
  refresh_token?: string
  email: string
  expires_at: number
  /**
   * Absolute path to an Ed25519 private key, set when the original
   * `apes login` was key-based (i.e. agent login). Lets `cli-auth`
   * refresh the access token in-process by signing a fresh challenge
   * — replaces the per-hour daemon restart cycle that was needed
   * before this field existed. Optional: human (PKCE) logins leave
   * it unset and continue to use the OAuth `refresh_token` path.
   */
  key_path?: string
}

/**
 * SP-scoped access token cached after a successful exchange. Stored per
 * audience under `~/.config/apes/sp-tokens/<aud>.json`.
 */
export interface SpToken {
  endpoint: string
  aud: string
  access_token: string
  expires_at: number
  scopes?: string[]
  /**
   * When the IdP-token used for the exchange was issued. Lets us evict the
   * SP-token cache if the IdP-token has been rotated since.
   */
  issued_from_idp_iat?: number
}

export class AuthError extends Error {
  status: number
  hint?: string

  constructor(status: number, message: string, hint?: string) {
    super(hint ? `${message}\n${hint}` : message)
    this.name = 'AuthError'
    this.status = status
    this.hint = hint
  }
}

/**
 * Thrown by `getAuthorizedBearer` when no valid IdP session can be obtained
 * (no auth file, refresh failed, etc.). Caller should surface a "run
 * `apes login`" message.
 */
export class NotLoggedInError extends AuthError {
  constructor(hint?: string) {
    super(
      401,
      'Not logged in',
      hint ?? 'Run `apes login <email>` once on this device to authenticate against the OpenApe IdP.',
    )
    this.name = 'NotLoggedInError'
  }
}
