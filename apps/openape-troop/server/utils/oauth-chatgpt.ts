// Token-endpoint response (Codex "Sign in with ChatGPT") → litellm's chatgpt
// auth.json shape. litellm reads ~/.config/litellm/chatgpt/auth.json and
// refreshes it in place; Troop only seeds the initial file (ape-plan M1/S2).

export interface ChatgptTokenResponse {
  access_token: string
  refresh_token: string
  id_token: string
}

export interface LitellmChatgptAuth {
  access_token: string
  refresh_token: string
  id_token: string
  expires_at: number
  account_id: string
}

function decodeJwtClaims(token: string): Record<string, unknown> {
  const payload = token.split('.')[1]
  if (!payload)
    throw new TypeError('access_token is not a JWT')
  return JSON.parse(Buffer.from(payload, 'base64url').toString()) as Record<string, unknown>
}

/**
 * Map an OpenAI token response to the on-disk shape litellm's chatgpt provider
 * expects. `expires_at` and `account_id` are read from the access-token claims
 * (`exp` and the `https://api.openai.com/auth.chatgpt_account_id` claim). Throws
 * loudly rather than emit an auth.json litellm would choke on.
 */
export function toLitellmAuthJson(token: ChatgptTokenResponse): LitellmChatgptAuth {
  const claims = decodeJwtClaims(token.access_token)
  const auth = claims['https://api.openai.com/auth'] as { chatgpt_account_id?: unknown } | undefined
  const accountId = auth?.chatgpt_account_id
  if (typeof accountId !== 'string')
    throw new TypeError('access_token has no chatgpt_account_id (https://api.openai.com/auth claim)')
  if (typeof claims.exp !== 'number')
    throw new TypeError('access_token has no numeric exp claim')
  return {
    access_token: token.access_token,
    refresh_token: token.refresh_token,
    id_token: token.id_token,
    expires_at: claims.exp,
    account_id: accountId,
  }
}

// --- Device flow (Codex "Sign in with ChatGPT", Auth0 behind auth.openai.com) ---

const CHATGPT_CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann'
const DEVICE_CODE_ENDPOINT = 'https://auth0.openai.com/oauth/device/code'
const TOKEN_ENDPOINT = 'https://auth0.openai.com/oauth/token'
const SCOPE = 'openid profile email offline_access'
const DEVICE_GRANT = 'urn:ietf:params:oauth:grant-type:device_code'

/** Agent-secret env name carrying the sealed ChatGPT auth.json (a file target, not an env var). */
export const CHATGPT_SECRET_ENV = 'CHATGPT_AUTH_JSON'
/**
 * Container path litellm reads. As of M3, litellm runs inside the nest with
 * HOME=/var/lib/openape/llm, and the agent (a non-root user) writes the sealed
 * auth.json here via the M2/S1 broker — one container, one filesystem. The
 * nest entrypoint makes this dir world-writable so any agent user can seed it.
 */
export const CHATGPT_AUTH_FILE_PATH = '/var/lib/openape/llm/.config/litellm/chatgpt/auth.json'

export interface DeviceFlowStart {
  device_code: string
  user_code: string
  verification_uri: string
  verification_uri_complete?: string
  interval: number
  expires_in: number
}

interface FetchResponse {
  ok: boolean
  status: number
  json: () => Promise<unknown>
}
type FetchLike = (url: string, init: { method: string, headers: Record<string, string>, body: string }) => Promise<FetchResponse>

function form(fields: Record<string, string>) {
  return {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(fields).toString(),
  }
}

/** Start the device-authorization flow → the user_code + verification URI the owner enters in a browser. */
export async function initiateChatgptDeviceFlow(fetchImpl: FetchLike): Promise<DeviceFlowStart> {
  const res = await fetchImpl(DEVICE_CODE_ENDPOINT, form({ client_id: CHATGPT_CLIENT_ID, scope: SCOPE }))
  if (!res.ok)
    throw new Error(`device/code failed (HTTP ${res.status})`)
  const data = await res.json() as Partial<DeviceFlowStart>
  if (typeof data.device_code !== 'string' || typeof data.user_code !== 'string')
    throw new TypeError('device/code response missing device_code/user_code')
  return {
    device_code: data.device_code,
    user_code: data.user_code,
    verification_uri: data.verification_uri ?? 'https://chatgpt.com/activate',
    verification_uri_complete: data.verification_uri_complete,
    interval: typeof data.interval === 'number' ? data.interval : 5,
    expires_in: typeof data.expires_in === 'number' ? data.expires_in : 900,
  }
}

export type PollResult =
  | { status: 'pending' }
  | { status: 'slow_down' }
  | { status: 'denied', error: string }
  | { status: 'token', token: ChatgptTokenResponse }

/** Poll the token endpoint once with a device_code. The caller loops on `pending`/`slow_down`. */
export async function pollChatgptToken(fetchImpl: FetchLike, deviceCode: string): Promise<PollResult> {
  const res = await fetchImpl(TOKEN_ENDPOINT, form({ client_id: CHATGPT_CLIENT_ID, grant_type: DEVICE_GRANT, device_code: deviceCode }))
  const data = await res.json() as Record<string, unknown>
  if (res.ok) {
    if (typeof data.access_token !== 'string' || typeof data.refresh_token !== 'string' || typeof data.id_token !== 'string')
      throw new TypeError('token response missing access_token/refresh_token/id_token')
    return { status: 'token', token: { access_token: data.access_token, refresh_token: data.refresh_token, id_token: data.id_token } }
  }
  const error = typeof data.error === 'string' ? data.error : `token failed (HTTP ${res.status})`
  if (error === 'authorization_pending')
    return { status: 'pending' }
  if (error === 'slow_down')
    return { status: 'slow_down' }
  return { status: 'denied', error }
}
