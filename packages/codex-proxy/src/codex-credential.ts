// Codex (ChatGPT-subscription) credential: we own the token and refresh it
// ourselves. Pattern from OpenClaw — never depend on the Codex CLI to keep the
// token live (its refresh would race ours and the last writer wins).

export interface CodexCredential {
  access_token: string
  refresh_token: string
  id_token: string
  /** epoch seconds — the access-token `exp`. */
  expires_at: number
  /** ChatGPT account id (from the access-token claim); sent as `chatgpt-account-id`. */
  account_id: string
}

export interface CodexTokenResponse {
  access_token: string
  refresh_token: string
  id_token: string
}

const CHATGPT_CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann'
const TOKEN_ENDPOINT = 'https://auth.openai.com/oauth/token'
/** Refresh this many ms before the access token actually expires. */
const REFRESH_SKEW_MS = 60_000

interface FetchResponse {
  ok: boolean
  status: number
  json: () => Promise<unknown>
}
type FetchLike = (url: string, init: { method: string, headers: Record<string, string>, body: string }) => Promise<FetchResponse>

function decodeJwtPayload(token: string): Record<string, unknown> {
  const payload = token.split('.')[1]
  if (!payload)
    throw new TypeError('access_token is not a JWT')
  return JSON.parse(Buffer.from(payload, 'base64url').toString()) as Record<string, unknown>
}

/** Read the two claims we need from a Codex access token: `exp` + `chatgpt_account_id`. */
export function decodeCodexClaims(accessToken: string): { exp: number, account_id: string } {
  const claims = decodeJwtPayload(accessToken)
  const auth = claims['https://api.openai.com/auth'] as { chatgpt_account_id?: unknown } | undefined
  const accountId = auth?.chatgpt_account_id
  if (typeof accountId !== 'string')
    throw new TypeError('access_token has no chatgpt_account_id (https://api.openai.com/auth claim)')
  if (typeof claims.exp !== 'number')
    throw new TypeError('access_token has no numeric exp claim')
  return { exp: claims.exp, account_id: accountId }
}

/** Build a credential from an OAuth token response, deriving exp + account_id from the access token. */
export function credentialFromTokenResponse(token: CodexTokenResponse): CodexCredential {
  const { exp, account_id } = decodeCodexClaims(token.access_token)
  return {
    access_token: token.access_token,
    refresh_token: token.refresh_token,
    id_token: token.id_token,
    expires_at: exp,
    account_id,
  }
}

export function isCodexCredentialExpired(cred: CodexCredential, nowMs: number, skewMs = REFRESH_SKEW_MS): boolean {
  return nowMs >= cred.expires_at * 1000 - skewMs
}

function form(fields: Record<string, string>) {
  return {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(fields).toString(),
  }
}

/** Exchange the refresh token for a fresh access token. Throws loudly on failure. */
export async function refreshCodexCredential(cred: CodexCredential, fetchImpl: FetchLike): Promise<CodexCredential> {
  const res = await fetchImpl(TOKEN_ENDPOINT, form({
    grant_type: 'refresh_token',
    refresh_token: cred.refresh_token,
    client_id: CHATGPT_CLIENT_ID,
  }))
  const data = await res.json() as Record<string, unknown>
  if (!res.ok) {
    const err = typeof data.error === 'string' ? data.error : `HTTP ${res.status}`
    throw new Error(`codex token refresh failed: ${err}`)
  }
  if (typeof data.access_token !== 'string')
    throw new TypeError('codex token refresh returned no access_token')
  // The grant may rotate the refresh/id token; keep the prior one when omitted.
  return credentialFromTokenResponse({
    access_token: data.access_token,
    refresh_token: typeof data.refresh_token === 'string' ? data.refresh_token : cred.refresh_token,
    id_token: typeof data.id_token === 'string' ? data.id_token : cred.id_token,
  })
}

/** Return a non-expired credential, refreshing via the refresh_token grant if needed. */
export async function ensureFreshCodexCredential(cred: CodexCredential, fetchImpl: FetchLike, nowMs: number): Promise<CodexCredential> {
  if (!isCodexCredentialExpired(cred, nowMs))
    return cred
  return refreshCodexCredential(cred, fetchImpl)
}
