import { describe, expect, it } from 'vitest'
import {
  credentialFromTokenResponse,
  decodeCodexClaims,
  ensureFreshCodexCredential,
  isCodexCredentialExpired,
} from '../src/codex-credential'

// Build a JWT whose payload carries the claims (signature irrelevant — we only
// read claims, we don't verify the token).
function jwt(payload: Record<string, unknown>): string {
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url')
  return `${b64({ alg: 'none', typ: 'JWT' })}.${b64(payload)}.sig`
}
function accessToken(exp: number, accountId = 'acc-1'): string {
  return jwt({ exp, 'https://api.openai.com/auth': { chatgpt_account_id: accountId } })
}

describe('decodeCodexClaims', () => {
  it('reads exp + chatgpt_account_id from the access token', () => {
    expect(decodeCodexClaims(accessToken(1781465881, 'acc-9'))).toEqual({ exp: 1781465881, account_id: 'acc-9' })
  })
  it('throws when chatgpt_account_id is missing', () => {
    expect(() => decodeCodexClaims(jwt({ exp: 1 }))).toThrow(/account_id/i)
  })
})

describe('credentialFromTokenResponse', () => {
  it('builds a credential, deriving exp + account_id from the access token', () => {
    const at = accessToken(1781465881, 'acc-2')
    expect(credentialFromTokenResponse({ access_token: at, refresh_token: 'rt', id_token: 'idt' })).toEqual({
      access_token: at,
      refresh_token: 'rt',
      id_token: 'idt',
      expires_at: 1781465881,
      account_id: 'acc-2',
    })
  })
})

describe('isCodexCredentialExpired', () => {
  const cred = { access_token: 'a', refresh_token: 'r', id_token: 'i', expires_at: 2000, account_id: 'x' }
  it('is expired once now is at/after expires_at', () => {
    expect(isCodexCredentialExpired(cred, 5_000_000)).toBe(true) // now=5000s ≥ 2000s
  })
  it('is fresh while now is well before expires_at', () => {
    expect(isCodexCredentialExpired(cred, 0)).toBe(false)
  })
})

describe('ensureFreshCodexCredential', () => {
  const stale = { access_token: accessToken(1000), refresh_token: 'old-rt', id_token: 'old-idt', expires_at: 1000, account_id: 'acc-1' }

  it('returns the same credential without fetching when still fresh', async () => {
    const fresh = { ...stale, expires_at: 9_999_999_999 }
    const out = await ensureFreshCodexCredential(fresh, () => Promise.reject(new Error('should not fetch')), 0)
    expect(out).toBe(fresh)
  })

  it('refreshes via the refresh_token grant when expired, rotating tokens', async () => {
    const newAt = accessToken(9_999_999_999, 'acc-1')
    const fetchImpl = async () => ({ ok: true, status: 200, json: async () => ({ access_token: newAt, refresh_token: 'new-rt', id_token: 'new-idt' }) })
    const out = await ensureFreshCodexCredential(stale, fetchImpl, 5_000_000_000)
    expect(out.access_token).toBe(newAt)
    expect(out.refresh_token).toBe('new-rt')
    expect(out.expires_at).toBe(9_999_999_999)
  })

  it('keeps the old refresh_token / id_token when the grant omits them', async () => {
    const newAt = accessToken(9_999_999_999, 'acc-1')
    const fetchImpl = async () => ({ ok: true, status: 200, json: async () => ({ access_token: newAt }) })
    const out = await ensureFreshCodexCredential(stale, fetchImpl, 5_000_000_000)
    expect(out.refresh_token).toBe('old-rt')
    expect(out.id_token).toBe('old-idt')
  })

  it('throws on a failed refresh (never returns a stale credential silently)', async () => {
    const fetchImpl = async () => ({ ok: false, status: 400, json: async () => ({ error: 'invalid_grant' }) })
    await expect(ensureFreshCodexCredential(stale, fetchImpl, 5_000_000_000)).rejects.toThrow(/refresh|invalid_grant|400/i)
  })
})
