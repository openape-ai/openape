import { InMemoryJtiStore, InMemoryKeyStore } from '@openape/auth'
import { generateCodeChallenge, signJWT } from '@openape/core'
import { describe, expect, it } from 'vitest'
import { mintCrossSpCode, verifyCrossSpCode } from '../src/runtime/server/utils/cross-sp-code'

const VERIFIER = 'a'.repeat(64)
const CLIENT = 'app.example'
const REDIRECT = 'https://app.example/oauth/spawn-callback'

async function setup() {
  const keyStore = new InMemoryKeyStore()
  const jtiStore = new InMemoryJtiStore()
  const codeChallenge = await generateCodeChallenge(VERIFIER)
  const code = await mintCrossSpCode(
    { grantId: 'grant-1', sub: 'owner@example.com', clientId: CLIENT, redirectUri: REDIRECT, codeChallenge },
    keyStore,
  )
  return { keyStore, jtiStore, code }
}

const good = { codeVerifier: VERIFIER, clientId: CLIENT, redirectUri: REDIRECT }

describe('cross-sp delegation code', () => {
  it('round-trips a valid code', async () => {
    const { keyStore, jtiStore, code } = await setup()
    const r = await verifyCrossSpCode(code, good, keyStore, jtiStore)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.claims.grant_id).toBe('grant-1')
      expect(r.claims.sub).toBe('owner@example.com')
    }
  })

  it('rejects a wrong PKCE verifier', async () => {
    const { keyStore, jtiStore, code } = await setup()
    const r = await verifyCrossSpCode(code, { ...good, codeVerifier: 'b'.repeat(64) }, keyStore, jtiStore)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toMatch(/PKCE/)
  })

  it('rejects client_id mismatch', async () => {
    const { keyStore, jtiStore, code } = await setup()
    const r = await verifyCrossSpCode(code, { ...good, clientId: 'evil.example.com' }, keyStore, jtiStore)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toMatch(/client_id/)
  })

  it('rejects redirect_uri mismatch', async () => {
    const { keyStore, jtiStore, code } = await setup()
    const r = await verifyCrossSpCode(code, { ...good, redirectUri: 'https://evil.example.com/cb' }, keyStore, jtiStore)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toMatch(/redirect_uri/)
  })

  it('is single-use — a replay within the TTL is rejected', async () => {
    const { keyStore, jtiStore, code } = await setup()
    const first = await verifyCrossSpCode(code, good, keyStore, jtiStore)
    expect(first.ok).toBe(true)
    const second = await verifyCrossSpCode(code, good, keyStore, jtiStore)
    expect(second.ok).toBe(false)
    if (!second.ok) expect(second.reason).toMatch(/already redeemed/)
  })

  it('rejects a tampered code', async () => {
    const { keyStore, jtiStore, code } = await setup()
    const tampered = `${code.slice(0, -4)}AAAA`
    const r = await verifyCrossSpCode(tampered, good, keyStore, jtiStore)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toMatch(/invalid code/)
  })

  it('rejects an expired code', async () => {
    const { keyStore, jtiStore } = await setup()
    const key = await keyStore.getSigningKey()
    const codeChallenge = await generateCodeChallenge(VERIFIER)
    const nowSec = Math.floor(Date.now() / 1000)
    const expired = await signJWT(
      {
        purpose: 'openape:cross-sp-delegation-code',
        grant_id: 'grant-1',
        sub: 'owner@example.com',
        client_id: CLIENT,
        redirect_uri: REDIRECT,
        code_challenge: codeChallenge,
        jti: crypto.randomUUID(),
        iat: nowSec - 120,
        exp: nowSec - 60,
      },
      key.privateKey,
      { kid: key.kid },
    )
    const r = await verifyCrossSpCode(expired, good, keyStore, jtiStore)
    expect(r.ok).toBe(false)
  })

  it('rejects a JWT signed for a different purpose', async () => {
    const { keyStore, jtiStore } = await setup()
    const key = await keyStore.getSigningKey()
    const codeChallenge = await generateCodeChallenge(VERIFIER)
    const nowSec = Math.floor(Date.now() / 1000)
    const wrongPurpose = await signJWT(
      { purpose: 'something-else', grant_id: 'g', sub: 'o', client_id: CLIENT, redirect_uri: REDIRECT, code_challenge: codeChallenge, jti: crypto.randomUUID(), iat: nowSec, exp: nowSec + 60 },
      key.privateKey,
      { kid: key.kid },
    )
    const r = await verifyCrossSpCode(wrongPurpose, good, keyStore, jtiStore)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toMatch(/purpose/)
  })
})
