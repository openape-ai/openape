import { describe, expect, it } from 'vitest'
import { CODEX_RESPONSES_URL, codexResponseHeaders } from '../src/codex-client'

const cred = { access_token: 'AT', refresh_token: 'r', id_token: 'i', expires_at: 1, account_id: 'acc-7' }

describe('codexResponseHeaders', () => {
  it('builds the mandatory Codex Responses headers', () => {
    const h = codexResponseHeaders(cred)
    expect(h.authorization).toBe('Bearer AT')
    expect(h['chatgpt-account-id']).toBe('acc-7')
    expect(h['openai-beta']).toBe('responses=experimental')
    expect(h.accept).toBe('text/event-stream')
    expect(h.originator).toBe('openape')
  })

  it('uses the configured originator', () => {
    expect(codexResponseHeaders(cred, 'codex_cli_rs').originator).toBe('codex_cli_rs')
  })

  it('targets the Codex Responses backend', () => {
    expect(CODEX_RESPONSES_URL).toBe('https://chatgpt.com/backend-api/codex/responses')
  })
})
