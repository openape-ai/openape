import { describe, expect, it } from 'vitest'
import { evaluatePolicy, validateAuthorizeRequest } from '../idp/authorize.js'
import { InMemoryConsentStore } from '../idp/stores.js'

describe('validateAuthorizeRequest', () => {
  const validParams = {
    response_type: 'code',
    client_id: 'sp.example.com',
    redirect_uri: 'https://sp.example.com/callback',
    state: 'random-state',
    code_challenge: 'challenge',
    code_challenge_method: 'S256',
    nonce: 'random-nonce',
  }

  it('accepts valid params', () => {
    expect(validateAuthorizeRequest(validParams)).toBeNull()
  })

  it('rejects non-code response_type', () => {
    const error = validateAuthorizeRequest({ ...validParams, response_type: 'token' })
    expect(error).toContain('response_type')
  })

  it('rejects non-S256 challenge method', () => {
    const error = validateAuthorizeRequest({ ...validParams, code_challenge_method: 'plain' })
    expect(error).toContain('code_challenge_method')
  })

  it('rejects missing params', () => {
    const error = validateAuthorizeRequest({ ...validParams, client_id: '' })
    expect(error).toContain('Missing')
  })
})

describe('evaluatePolicy', () => {
  it('allows for open mode', async () => {
    const store = new InMemoryConsentStore()
    expect(await evaluatePolicy('open', 'sp', 'user', store)).toBe('allow')
  })

  it('denies for deny mode', async () => {
    const store = new InMemoryConsentStore()
    expect(await evaluatePolicy('deny', 'sp', 'user', store)).toBe('deny')
  })

  it('requires consent for allowlist-user without existing consent', async () => {
    const store = new InMemoryConsentStore()
    expect(await evaluatePolicy('allowlist-user', 'sp', 'user', store)).toBe('consent')
  })

  it('allows for allowlist-user with existing consent', async () => {
    const store = new InMemoryConsentStore()
    await store.save({ userId: 'user', clientId: 'sp', grantedAt: Date.now() })
    expect(await evaluatePolicy('allowlist-user', 'sp', 'user', store)).toBe('allow')
  })

  it('denies for allowlist-admin mode', async () => {
    const store = new InMemoryConsentStore()
    expect(await evaluatePolicy('allowlist-admin', 'sp', 'user', store)).toBe('deny')
  })

  it('defaults to consent for undefined mode', async () => {
    const store = new InMemoryConsentStore()
    expect(await evaluatePolicy(undefined, 'sp', 'user', store)).toBe('consent')
  })
})

describe('InMemoryConsentStore — list / revoke (#301)', () => {
  it('list returns approved SPs sorted by grantedAt desc', async () => {
    const store = new InMemoryConsentStore()
    await store.save({ userId: 'patrick@hofmann.eco', clientId: 'chat.openape.ai', grantedAt: 100 })
    await store.save({ userId: 'patrick@hofmann.eco', clientId: 'plans.openape.ai', grantedAt: 200 })
    // Other-user entry is excluded.
    await store.save({ userId: 'other@example.com', clientId: 'tasks.openape.ai', grantedAt: 300 })

    const out = await store.list('patrick@hofmann.eco')
    expect(out.map(e => e.clientId)).toEqual(['plans.openape.ai', 'chat.openape.ai'])
  })

  it('list returns empty for user with no consents', async () => {
    const store = new InMemoryConsentStore()
    expect(await store.list('nobody@example.com')).toEqual([])
  })

  it('revoke removes consent — hasConsent returns false afterward', async () => {
    const store = new InMemoryConsentStore()
    await store.save({ userId: 'patrick@hofmann.eco', clientId: 'chat.openape.ai', grantedAt: 1 })
    expect(await store.hasConsent('patrick@hofmann.eco', 'chat.openape.ai')).toBe(true)

    await store.revoke('patrick@hofmann.eco', 'chat.openape.ai')
    expect(await store.hasConsent('patrick@hofmann.eco', 'chat.openape.ai')).toBe(false)
  })

  it('revoke is a no-op when no consent exists', async () => {
    const store = new InMemoryConsentStore()
    await expect(store.revoke('a@x', 'b.example')).resolves.toBeUndefined()
  })
})
