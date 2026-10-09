/** Tokens of one owner sign-in; they live only in this object in the main process and are never written anywhere. */
export interface OwnerSessionTokens { issuer: string, account: string, subject: string, accessToken: string, refreshToken: string, expiresAt: number }
export interface OwnerSessionAuthority {
  refresh: (tokens: OwnerSessionTokens, signal: AbortSignal) => Promise<OwnerSessionTokens>
  revoke: (tokens: OwnerSessionTokens) => Promise<void>
}

export class OwnerSessionEnded extends Error {
  constructor() { super('The owner session ended; ask the owner to sign in again before deciding grants') }
}

/**
 * The owner's identity for one MCP session. An approval made with it is the owner's own decision (the session is
 * the owner's DDISA login, confirmed in the app). The IdP issues five-minute access tokens, so the session renews
 * them in memory with the refresh token of this sign-in only, never past `endsAt`; closing the session discards
 * both and revokes the refresh token at the IdP. The persisted setup connection is a different login and is never
 * turned into an OwnerSession.
 */
export class OwnerSession {
  #tokens: OwnerSessionTokens | null
  #renewal: Promise<OwnerSessionTokens> | null = null
  readonly issuer: string
  readonly subject: string
  readonly account: string
  constructor(tokens: OwnerSessionTokens, readonly endsAt: number, private readonly authority: OwnerSessionAuthority, private readonly now: () => number = Date.now) {
    this.#tokens = tokens
    this.issuer = tokens.issuer; this.subject = tokens.subject; this.account = tokens.account
  }

  get active(): boolean { return this.#tokens !== null && this.now() < this.endsAt }

  /** A current owner access token, or OwnerSessionEnded once the session is closed or past its hard end. */
  async bearer(signal: AbortSignal): Promise<string> {
    const tokens = this.current()
    if (tokens.expiresAt * 1000 > this.now() + 30000) return tokens.accessToken
    this.#renewal ??= this.authority.refresh(tokens, signal).finally(() => { this.#renewal = null })
    const renewed = await this.#renewal
    if (renewed.subject !== this.subject || renewed.issuer !== this.issuer) { this.close(); throw new Error('The renewed owner identity differs from the signed-in owner') }
    if (!this.#tokens) throw new OwnerSessionEnded()
    this.#tokens = renewed
    return this.current().accessToken
  }

  close(): void {
    const tokens = this.#tokens
    this.#tokens = null
    if (tokens) void this.authority.revoke(tokens).catch((error: unknown) => console.error('Could not revoke the ended owner session at the IdP:', error instanceof Error ? error.message : 'unknown error'))
  }

  private current(): OwnerSessionTokens {
    if (!this.#tokens) throw new OwnerSessionEnded()
    if (this.now() >= this.endsAt) { this.close(); throw new OwnerSessionEnded() }
    return this.#tokens
  }
}
