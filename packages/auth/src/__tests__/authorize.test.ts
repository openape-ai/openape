import { describe, expect, it } from 'vitest'
import { evaluatePolicy, validateAuthorizeRequest } from '../idp/authorize.js'
import { InMemoryAdminAllowlistStore, InMemoryConsentStore } from '../idp/stores.js'

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

  it('denies for allowlist-admin mode without an allowlist store wired up', async () => {
    // Backward-compat default — callers that don't pass an allowlist
    // store get the safe deny-all behaviour for this mode.
    const store = new InMemoryConsentStore()
    expect(await evaluatePolicy('allowlist-admin', 'sp.example.com', 'user@deltamind.at', store)).toBe('deny')
  })

  it('denies for allowlist-admin when SP not in the domain allowlist (#307)', async () => {
    const store = new InMemoryConsentStore()
    const allowlist = new InMemoryAdminAllowlistStore()
    expect(await evaluatePolicy(
      'allowlist-admin',
      'unapproved.example.com',
      'user@deltamind.at',
      store,
      { adminAllowlistStore: allowlist },
    )).toBe('deny')
  })

  it('allows for allowlist-admin when SP is in the domain allowlist (#307)', async () => {
    const store = new InMemoryConsentStore()
    const allowlist = new InMemoryAdminAllowlistStore()
    allowlist.add('deltamind.at', 'plans.openape.ai')
    expect(await evaluatePolicy(
      'allowlist-admin',
      'plans.openape.ai',
      'user@deltamind.at',
      store,
      { adminAllowlistStore: allowlist },
    )).toBe('allow')
  })

  it('scopes allowlist-admin per user-domain — entry for deltamind.at does NOT cover example.com users', async () => {
    const store = new InMemoryConsentStore()
    const allowlist = new InMemoryAdminAllowlistStore()
    allowlist.add('deltamind.at', 'plans.openape.ai')
    expect(await evaluatePolicy(
      'allowlist-admin',
      'plans.openape.ai',
      'someone@example.com',
      store,
      { adminAllowlistStore: allowlist },
    )).toBe('deny')
  })

  it('denies allowlist-admin when userId has no @ separator', async () => {
    const store = new InMemoryConsentStore()
    const allowlist = new InMemoryAdminAllowlistStore()
    allowlist.add('', 'plans.openape.ai')
    // Even if the empty domain is in the allowlist (operator config
    // accident), an unparseable user identifier still denies.
    expect(await evaluatePolicy(
      'allowlist-admin',
      'plans.openape.ai',
      'malformed-no-at-sign',
      store,
      { adminAllowlistStore: allowlist },
    )).toBe('deny')
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
