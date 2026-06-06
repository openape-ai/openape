import { describe, expect, it } from 'vitest'
import { initiateChatgptDeviceFlow, pollChatgptToken, toCodexAuthJson } from '../server/utils/oauth-chatgpt'

// A fetch double that always answers with the given status + JSON body.
function fetchReturning(status: number, body: unknown) {
  return async () => ({ ok: status >= 200 && status < 300, status, json: async () => body })
}

// Build a JWT whose payload carries the given claims (signature is irrelevant —
// the serializer only reads claims, it does not verify the token).
function makeJwt(payload: Record<string, unknown>): string {
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url')
  return `${b64({ alg: 'none', typ: 'JWT' })}.${b64(payload)}.sig`
}

describe('toCodexAuthJson', () => {
  it('maps a token response to the codex-proxy auth.json (exp + chatgpt_account_id from the access token)', () => {
    const accessToken = makeJwt({
      exp: 1781465881,
      'https://api.openai.com/auth': { chatgpt_account_id: 'acc-123' },
    })
    const out = toCodexAuthJson({ access_token: accessToken, refresh_token: 'rt_x', id_token: 'idt' })
    expect(out).toEqual({
      access_token: accessToken,
      refresh_token: 'rt_x',
      id_token: 'idt',
      expires_at: 1781465881,
      account_id: 'acc-123',
    })
  })

  it('throws when the access token lacks chatgpt_account_id (never write a broken auth.json)', () => {
    const accessToken = makeJwt({ exp: 1781465881 })
    expect(() => toCodexAuthJson({ access_token: accessToken, refresh_token: 'rt_x', id_token: 'idt' }))
      .toThrow(/account_id/i)
  })
})

describe('initiateChatgptDeviceFlow', () => {
  it('parses the device/code response', async () => {
    const r = await initiateChatgptDeviceFlow(fetchReturning(200, {
      device_code: 'dc', user_code: 'WXYZ-1234', verification_uri: 'https://chatgpt.com/activate', interval: 5, expires_in: 900,
    }))
    expect(r.device_code).toBe('dc')
    expect(r.user_code).toBe('WXYZ-1234')
    expect(r.interval).toBe(5)
  })

  it('throws when device_code is missing', async () => {
    await expect(initiateChatgptDeviceFlow(fetchReturning(200, { user_code: 'x' }))).rejects.toThrow(/device_code/i)
  })
})

describe('pollChatgptToken', () => {
  it('returns pending on authorization_pending', async () => {
    const r = await pollChatgptToken(fetchReturning(400, { error: 'authorization_pending' }), 'dc')
    expect(r.status).toBe('pending')
  })

  it('returns the token on success', async () => {
    const r = await pollChatgptToken(fetchReturning(200, { access_token: 'at', refresh_token: 'rt', id_token: 'idt' }), 'dc')
    expect(r).toEqual({ status: 'token', token: { access_token: 'at', refresh_token: 'rt', id_token: 'idt' } })
  })

  it('returns denied on access_denied', async () => {
    const r = await pollChatgptToken(fetchReturning(400, { error: 'access_denied' }), 'dc')
    expect(r.status).toBe('denied')
  })
})
