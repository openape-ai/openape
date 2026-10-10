// @vitest-environment node
import { createHash, generateKeyPairSync, randomUUID, sign } from 'node:crypto'
import { request } from 'node:http'
import { afterEach, expect, it, vi } from 'vitest'
import { OwnerConnection, ownerClaims } from '../../src/main/connections/owner'
import type { CredentialCache } from '../../src/main/connections/cache'
import { parseOnboardingCommand, parseSince } from '../../src/contracts/onboarding'
import { readJSON } from '../../src/main/connections/http'

it('verifies owner signature, audience, human role, expiry, nonce and expected identity', () => {
  const keys = generateKeyPairSync('ed25519'); const jwk = { ...keys.publicKey.export({ format: 'jwk' }), kid: 'owner-key' }
  const claims = { iss: 'https://identity.example.invalid', aud: 'apes-cli', act: 'human', sub: 'owner', email: 'owner@example.invalid', nonce: 'state-nonce', exp: Math.floor(Date.now() / 1000) + 300 }
  const token = (body: Record<string, unknown>) => { const data = [Buffer.from(JSON.stringify({ alg: 'EdDSA', kid: jwk.kid })).toString('base64url'), Buffer.from(JSON.stringify(body)).toString('base64url')].join('.'); return `${data}.${sign(null, Buffer.from(data), keys.privateKey).toString('base64url')}` }
  expect(ownerClaims(token(claims), { keys: [jwk] }, claims.iss, claims.email, claims.nonce).sub).toBe('owner')
  for (const delta of [{ aud: 'another-client' }, { act: 'agent' }, { email: 'foreign@example.invalid' }, { exp: 1 }, { nonce: 'foreign' }, { nbf: Date.now() / 1000 + 100 }, { iss: 'https://foreign.invalid' }]) expect(() => ownerClaims(token({ ...claims, ...delta }), { keys: [jwk] }, claims.iss, claims.email, claims.nonce)).toThrow()
  expect(() => ownerClaims(`${token(claims).slice(0, -8)}AAAAAAAA`, { keys: [jwk] }, claims.iss, claims.email)).toThrow('signature')
  expect(() => ownerClaims(token(claims), { keys: [jwk, jwk] }, claims.iss, claims.email)).toThrow('signature')
})
afterEach(() => { vi.unstubAllGlobals() })
// The MCP session re-runs the owner's browser sign-in: the real loopback callback,
// code exchange and token checks, with only the identity provider replaced.
it('signs the MCP owner in only for a human token of the registered account, keeps its tokens in memory and stores nothing', async () => {
  const keys = generateKeyPairSync('ed25519'); const jwk = { ...keys.publicKey.export({ format: 'jwk' }), kid: 'owner-key' }
  const issuer = 'https://identity.example.invalid'; const account = 'owner@example.invalid'
  const token = (body: Record<string, unknown>) => { const data = [Buffer.from(JSON.stringify({ alg: 'EdDSA', kid: jwk.kid })).toString('base64url'), Buffer.from(JSON.stringify(body)).toString('base64url')].join('.'); return `${data}.${sign(null, Buffer.from(data), keys.privateKey).toString('base64url')}` }
  let claims: (nonce: string) => Record<string, unknown> = () => ({}); let nonce = ''
  const revoked: string[] = []; let refreshes = 0
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (url === `${issuer}/revoke`) { revoked.push(JSON.parse(String(init?.body)).token as string); return new Response('{"status":"ok"}') }
    if (url === `${issuer}/token` && JSON.parse(String(init?.body)).grant_type === 'refresh_token') { refreshes++; return new Response(JSON.stringify({ access_token: token({ ...claims(nonce), nonce: undefined, exp: Math.floor(Date.now() / 1000) + 300 }), refresh_token: `synthetic-refresh-${refreshes}` })) }
    if (url === `${issuer}/token`) return new Response(JSON.stringify({ access_token: token(claims(nonce)), refresh_token: 'synthetic-refresh' }))
    if (url === `${issuer}/.well-known/jwks.json`) return new Response(JSON.stringify({ keys: [jwk] }))
    throw new Error(`Unexpected request ${url}`)
  }))
  const connect = vi.fn(); const owner = new OwnerConnection({ connect } as unknown as CredentialCache)
  const callback = (url: string) => new Promise<void>((resolve, reject) => {
    const target = new URL(url).searchParams; nonce = target.get('nonce')!
    const query = new URLSearchParams({ state: target.get('state')!, code: 'synthetic-code' })
    request({ host: '127.0.0.1', port: 9876, path: `/callback?${query}`, headers: { host: 'localhost:9876' } }, (response) => { response.resume(); response.on('end', resolve) }).on('error', reject).end()
  })
  // Like a browser, the callback is answered while the sign-in continues; its delivery is awaited, never dropped.
  const verify = async () => {
    let delivered = Promise.resolve()
    const result = owner.session(issuer, account, Date.now() + 3600000, new AbortController().signal, ({ url }) => { delivered = callback(url) })
    try { return await result }
    finally { await delivered }
  }
  const human = (value: string) => ({ iss: issuer, aud: 'apes-cli', act: 'human', sub: 'owner-subject', email: account, nonce: value, exp: Math.floor(Date.now() / 1000) + 300 })
  claims = human
  const session = await verify()
  expect(session.subject).toBe('owner-subject')
  // A token close to its five-minute expiry is renewed in memory with this sign-in's refresh token only.
  expect(await session.bearer(new AbortController().signal)).toMatch(/\./)
  claims = value => ({ ...human(value), exp: Math.floor(Date.now() / 1000) + 10 })
  const short = await verify()
  await short.bearer(new AbortController().signal)
  expect(refreshes).toBe(1)
  // Ending the session discards the tokens and revokes the current refresh token at the IdP.
  short.close(); session.close()
  await vi.waitFor(() => expect(revoked.sort()).toEqual(['synthetic-refresh', 'synthetic-refresh-1']))
  await expect(short.bearer(new AbortController().signal)).rejects.toThrow('owner session ended')
  claims = human
  for (const change of [{ act: 'agent' }, { email: 'foreign@example.invalid' }, { aud: 'another-client' }, { nonce: 'replayed-nonce' }]) {
    claims = value => ({ ...human(value), ...change })
    await expect(verify(), JSON.stringify(change)).rejects.toThrow('Owner identity does not match the requested account')
  }
  expect(connect).not.toHaveBeenCalled()
})
function identityProvider() {
  const keys = generateKeyPairSync('ed25519'); const jwk = { ...keys.publicKey.export({ format: 'jwk' }), kid: 'owner-key' }
  const issuer = 'https://identity.example.invalid'; const account = 'owner@example.invalid'
  const token = (body: Record<string, unknown>) => { const data = [Buffer.from(JSON.stringify({ alg: 'EdDSA', kid: jwk.kid })).toString('base64url'), Buffer.from(JSON.stringify(body)).toString('base64url')].join('.'); return `${data}.${sign(null, Buffer.from(data), keys.privateKey).toString('base64url')}` }
  const human = (extra: Record<string, unknown> = {}) => ({ iss: issuer, aud: 'apes-cli', act: 'human', sub: 'owner-subject', email: account, exp: Math.floor(Date.now() / 1000) + 300, ...extra })
  return { jwk, issuer, account, token, human }
}

// The apes CLI proof: the owner's logged-in apes access token is checked like a browser sign-in and is never revoked by Pods.
it('opens an apes session only for a human token of the registered owner and ends it with apes logout', async () => {
  const { jwk, issuer, account, token, human } = identityProvider()
  const requests: string[] = []
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    requests.push(String(url))
    if (url === `${issuer}/.well-known/jwks.json`) return new Response(JSON.stringify({ keys: [jwk] }))
    throw new Error(`Unexpected request ${url}`)
  }))
  let current: { issuer: string, accessToken: string } | null = { issuer, accessToken: token(human()) }; let loggedIn = true
  const login = { token: vi.fn(async () => current), signedIn: vi.fn(() => loggedIn) }
  const owner = new OwnerConnection({} as CredentialCache)
  const open = () => owner.apesSession(issuer, account, Date.now() + 3600000, new AbortController().signal, login)
  const session = (await open())!
  expect(session.subject).toBe('owner-subject')
  expect(await session.bearer(new AbortController().signal)).toBe(current.accessToken)
  for (const [name, proof] of [
    ['agent identity', token(human({ act: 'agent' }))],
    ['delegated identity', token(human({ act: { sub: 'agent@example.invalid' } }))],
    ['foreign account', token(human({ email: 'foreign@example.invalid' }))],
    ['foreign audience', token(human({ aud: 'another-client' }))],
    ['expired token', token(human({ exp: Math.floor(Date.now() / 1000) - 1 }))],
    ['bad signature', `${token(human()).slice(0, -8)}AAAAAAAA`],
  ] as const) {
    current = { issuer, accessToken: proof }
    await expect(open(), name).rejects.toThrow(/Owner identity|signature/)
  }
  current = { issuer: 'https://foreign.example.invalid', accessToken: token(human()) }
  await expect(open()).rejects.toThrow('another identity provider')
  current = null
  expect(await open()).toBeNull()
  // A token near its end is re-derived from the still valid apes login; apes logout ends the session.
  current = { issuer, accessToken: token(human({ exp: Math.floor(Date.now() / 1000) + 10 })) }
  const short = (await open())!
  current = { issuer, accessToken: token(human()) }
  expect(await short.bearer(new AbortController().signal)).toBe(current.accessToken)
  loggedIn = false
  expect(short.active).toBe(false)
  await expect(short.bearer(new AbortController().signal)).rejects.toThrow('owner session ended')
  loggedIn = true
  current = { issuer, accessToken: token(human({ exp: Math.floor(Date.now() / 1000) + 10 })) }
  const renewing = (await open())!
  current = null
  await expect(renewing.bearer(new AbortController().signal)).rejects.toThrow('apes login ended')
  session.close(); renewing.close()
  expect(requests.every(url => url.endsWith('/.well-known/jwks.json'))).toBe(true)
})

// The phone confirmation: the IdP QR channel with the claim secret kept here, the transferred session used once for PKCE.
it('opens a phone session only after the owner approved the channel and keeps only the tokens Pods minted', async () => {
  const { jwk, issuer, account, token, human } = identityProvider()
  const channelId = 'c'.repeat(64); const claimSecret = 'd'.repeat(64); let expiresIn = 120
  let claim: () => Response = () => new Response(JSON.stringify({ status: 'pending' }))
  let authorize: (url: URL) => Response = () => new Response(null, { status: 302, headers: { location: '/login' } })
  const seen: { url: string, init?: RequestInit }[] = []
  vi.stubGlobal('fetch', vi.fn(async (input: string | URL, init?: RequestInit) => {
    const url = String(input); seen.push({ url, init })
    if (url === `${issuer}/api/session/qr`) return new Response(JSON.stringify({ channelId, claimSecret, expiresIn }))
    if (url === `${issuer}/api/session/qr/${channelId}/claim`) { expect(JSON.parse(String(init?.body))).toEqual({ claimSecret }); return claim() }
    if (url.startsWith(`${issuer}/authorize?`)) return authorize(new URL(url))
    if (url === `${issuer}/token`) { const nonce = new URL(seen.filter(item => item.url.startsWith(`${issuer}/authorize?`)).at(-1)!.url).searchParams.get('nonce'); return new Response(JSON.stringify({ access_token: token(human({ nonce })), refresh_token: 'phone-refresh' })) }
    if (url === `${issuer}/.well-known/jwks.json`) return new Response(JSON.stringify({ keys: [jwk] }))
    if (url === `${issuer}/api/session/qr/sessions/${channelId}`) return new Response('{"ok":true}')
    if (url === `${issuer}/revoke`) return new Response('{"status":"ok"}')
    throw new Error(`Unexpected request ${url}`)
  }))
  const owner = new OwnerConnection({} as CredentialCache)
  const open = (signal = new AbortController().signal) => owner.phoneSession(issuer, account, Date.now() + 3600000, signal, 'OpenApe Pods/test (Codex MCP sign-in)')
  // Denied: the IdP removes the channel, so the claim fails before its end.
  claim = () => new Response('{}', { status: 401 })
  const denied = await open()
  expect(denied.link).toBe(`${issuer}/link?c=${channelId}`)
  expect(new Headers(seen[0]!.init?.headers).get('user-agent')).toBe('OpenApe Pods/test (Codex MCP sign-in)')
  await expect(denied.session).rejects.toMatchObject({ outcome: 'denied' })
  // Unapproved until its end: no session.
  claim = () => new Response(JSON.stringify({ status: 'pending' }))
  expiresIn = 2
  await expect((await open()).session).rejects.toMatchObject({ outcome: 'expired' })
  expiresIn = 120
  const cancelled = new AbortController(); const unapproved = await open(cancelled.signal)
  await vi.waitFor(() => expect(seen.filter(item => item.url.endsWith('/claim')).length).toBe(3))
  cancelled.abort(new Error('ended')); await expect(unapproved.session).rejects.toThrow('ended')
  // Approved, but the transferred session belongs to another account: the IdP sends it to sign-in, no tokens.
  claim = () => new Response(JSON.stringify({ status: 'ok' }), { headers: [['set-cookie', 'openape-idp=sealed-session; Path=/; HttpOnly; Secure']] })
  await expect((await open()).session).rejects.toThrow('did not authorize')
  // Approved for the owner: PKCE with the transferred cookie, then that IdP session is ended at once.
  authorize = (url) => {
    expect(url.searchParams.get('client_id')).toBe('apes-cli'); expect(url.searchParams.get('login_hint')).toBe(account)
    return new Response(null, { status: 302, headers: { location: `http://localhost:9876/callback?code=phone-code&state=${url.searchParams.get('state')}` } })
  }
  const session = await (await open()).session
  expect(session.subject).toBe('owner-subject')
  const cookies = seen.filter(item => item.url.startsWith(`${issuer}/authorize?`) || item.url.endsWith(`/sessions/${channelId}`)).map(item => new Headers(item.init?.headers).get('cookie'))
  expect(cookies.every(value => value === 'openape-idp=sealed-session')).toBe(true)
  expect(seen.filter(item => item.url.endsWith(`/sessions/${channelId}`)).map(item => item.init?.method)).toEqual(['DELETE', 'DELETE'])
  session.close()
  await vi.waitFor(() => expect(seen.some(item => item.url === `${issuer}/revoke` && JSON.parse(String(item.init?.body)).token === 'phone-refresh')).toBe(true))
})

it('rejects privilege-bearing setup input and invalid historical boundaries', () => {
  for (const value of [{ type: 'connect', provider: 'microsoft', account: 'a@example.invalid', issuer: 'https://foreign.invalid' }, { type: 'connect', provider: 'openape', account: 'a@example.invalid', issuer: 'http://localhost' }, { type: 'connect', provider: 'chatgpt', account: '', token: 'forbidden' }, { type: 'save', connection: {} }]) expect(() => parseOnboardingCommand(value)).toThrow()
  expect(parseSince(null)).toBeNull(); expect(parseSince('2026-06-01T00:00:00Z')).toBe('2026-06-01T00:00:00Z')
  for (const value of ['2026-02-30T00:00:00Z', '2026-06-01T12:00:00Z', '2026-06-01', createHash('sha256').update('not-date').digest('hex')]) expect(() => parseSince(value)).toThrow()
  expect(() => parseOnboardingCommand({ type: 'assign', setup: { podId: randomUUID(), revision: 1, ownerConnection: randomUUID(), mailConnection: randomUUID(), account: 'a@example.invalid', folders: [{ id: '../foreign', name: 'Foreign' }], since: null, attachments: false } })).toThrow()
})
it('stops oversized authentication responses before parsing and hides provider error bodies', async () => {
  await expect(readJSON(new Response('secret detail', { status: 401 }))).rejects.toThrow('401')
  await expect(readJSON(new Response(JSON.stringify({ content: 'a'.repeat(130 * 1024) })))).rejects.toThrow('limit')
  await expect(readJSON(new Response('[]'))).rejects.toThrow('Invalid')
})

it('accepts explicit account actions without accepting identity or token injection', () => {
  const id = randomUUID()
  for (const type of ['disconnect', 'cancel']) {
    expect(parseOnboardingCommand({ type, id })).toEqual({ type, id })
    expect(() => parseOnboardingCommand({ type, id: 'not-an-id' })).toThrow()
    expect(() => parseOnboardingCommand({ type, id, token: 'forbidden' })).toThrow()
  }
  for (const type of ['setDefaultOwner', 'reconnect']) expect(() => parseOnboardingCommand({ type, id })).toThrow('Unsupported')
  expect(() => parseOnboardingCommand({ type: 'connect', provider: 'openape', account: 'owner@example.invalid', issuer: 'https://id.example.invalid' })).toThrow('Unsupported')
  expect(() => parseOnboardingCommand({ type: 'connect', provider: 'chatgpt', account: '', switchAccount: true })).toThrow('DDISA')
  expect(parseOnboardingCommand({ type: 'connect', provider: 'openape', account: 'owner@example.invalid', switchAccount: true })).toMatchObject({ switchAccount: true })
})
