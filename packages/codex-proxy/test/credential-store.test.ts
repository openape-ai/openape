import { mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { CodexCredentialStore, loadCodexCredential, saveCodexCredential } from '../src/credential-store'

function jwt(payload: Record<string, unknown>): string {
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url')
  return `${b64({ alg: 'none' })}.${b64(payload)}.sig`
}
function at(exp: number, acc = 'acc'): string {
  return jwt({ exp, 'https://api.openai.com/auth': { chatgpt_account_id: acc } })
}

let dir: string
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'cp-store-')) })
afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe('codex credential store', () => {
  it('saves + loads a credential round-trip with mode 0600, creating parent dirs', () => {
    const path = join(dir, 'litellm', 'chatgpt', 'auth.json')
    const cred = { access_token: at(123), refresh_token: 'r', id_token: 'i', expires_at: 123, account_id: 'acc' }
    saveCodexCredential(path, cred)
    expect(loadCodexCredential(path)).toEqual(cred)
    expect(statSync(path).mode & 0o777).toBe(0o600)
  })

  it('get() refreshes an expired credential and writes the new token back', async () => {
    const path = join(dir, 'auth.json')
    const newAt = at(9_999_999_999, 'acc')
    writeFileSync(path, JSON.stringify({ access_token: at(1000), refresh_token: 'old', id_token: 'i', expires_at: 1000, account_id: 'acc' }))
    const fakeFetch = (async () => ({ ok: true, status: 200, json: async () => ({ access_token: newAt, refresh_token: 'new' }) })) as unknown as typeof fetch
    const store = new CodexCredentialStore(path, fakeFetch)
    const out = await store.get(5_000_000_000)
    expect(out.access_token).toBe(newAt)
    expect(out.refresh_token).toBe('new')
    expect(loadCodexCredential(path).access_token).toBe(newAt) // persisted
  })

  it('get() returns the stored credential without refreshing while fresh', async () => {
    const path = join(dir, 'auth.json')
    writeFileSync(path, JSON.stringify({ access_token: at(9_999_999_999), refresh_token: 'keep', id_token: 'i', expires_at: 9_999_999_999, account_id: 'acc' }))
    const store = new CodexCredentialStore(path, (() => Promise.reject(new Error('should not fetch'))) as unknown as typeof fetch)
    expect((await store.get(0)).refresh_token).toBe('keep')
  })
})
