import { generateKeyPairSync, verify } from 'node:crypto'
import { expect, it, vi } from 'vitest'
import { httpRequestBodyChars, httpResponseBodyBytes, parseHttpAuthentication, parseHttpRequest, parseHttpPermission } from '../../src/contracts/http'
import { DdisaAgentTokens } from '../../src/main/programs/ddisa-agent'
import { requestHttp } from '../../src/main/programs/http'

it('requires an assigned HTTPS origin and method, bounds payloads and requires stable effect identities', () => {
  const permission = parseHttpPermission({ origin: 'https://api.example.invalid', methods: ['GET', 'POST'] })
  expect(parseHttpRequest({ url: 'https://api.example.invalid/items', method: 'GET' }, permission).method).toBe('GET')
  expect(() => parseHttpRequest({ url: 'https://foreign.example.invalid/items', method: 'GET' }, permission)).toThrow('assigned')
  expect(() => parseHttpRequest({ url: 'https://api.example.invalid/items', method: 'DELETE', key: 'delete:1' }, permission)).toThrow('assigned')
  expect(() => parseHttpRequest({ url: 'https://api.example.invalid/items', method: 'POST', body: '{}' }, permission)).toThrow('effect key')
  expect(() => parseHttpRequest({ url: 'https://api.example.invalid/items', method: 'POST', key: 'send:1', headers: { Host: 'foreign.example.invalid' } }, permission)).toThrow('headers')
  expect(() => parseHttpPermission({ origin: 'http://localhost', methods: ['GET'] })).toThrow('HTTPS')
  expect(() => parseHttpPermission({ origin: 'https://api.example.invalid/path', methods: ['GET'] })).toThrow('origin')
  expect(() => parseHttpRequest({ url: 'https://api.example.invalid/items', method: 'GET', body: 'x' }, permission)).toThrow('body')
})

it('does not follow redirects, passes cancellation and reports transport failures without request secrets', async () => {
  const permission = { origin: 'https://api.example.invalid', methods: ['POST'] }
  const request = parseHttpRequest({ url: 'https://api.example.invalid/botSYNTHETIC_SECRET/send', method: 'POST', key: 'mail:1', body: '{"chat_id":"synthetic"}' }, permission)
  const controller = new AbortController()
  const transport = vi.fn(async () => new Response('{"ok":true}', { status: 200, headers: { 'content-type': 'application/json' } }))
  expect(await requestHttp(request, controller.signal, transport)).toMatchObject({ status: 200, body: '{"ok":true}' })
  expect(transport.mock.calls[0]).toMatchObject([request.url, { redirect: 'error', signal: expect.any(AbortSignal) }])
  await expect(requestHttp(request, controller.signal, async () => { throw new Error(`Network failure at ${request.url}`) })).rejects.toThrow('HTTP request failed; delivery may be uncertain')
  controller.abort()
  const untouched = vi.fn()
  await expect(requestHttp(request, controller.signal, untouched)).rejects.toThrow()
  expect(untouched).not.toHaveBeenCalled()
})

it('accepts larger bounded bodies and digest receipts only for effects', async () => {
  const permission = parseHttpPermission({ origin: 'https://api.example.invalid', methods: ['GET', 'POST'] })
  const body = 'x'.repeat(httpRequestBodyChars)
  expect(parseHttpRequest({ url: 'https://api.example.invalid/items', method: 'POST', key: 'send:1', body, receipt: 'digest' }, permission)).toMatchObject({ body, receipt: 'digest' })
  expect(() => parseHttpRequest({ url: 'https://api.example.invalid/items', method: 'POST', key: 'send:1', body: `${body}x` }, permission)).toThrow('body')
  expect(() => parseHttpRequest({ url: 'https://api.example.invalid/items', method: 'GET', receipt: 'digest' }, permission)).toThrow('receipt')
  const large = 'y'.repeat(httpResponseBodyBytes)
  const signal = new AbortController().signal
  expect((await requestHttp(parseHttpRequest({ url: 'https://api.example.invalid/items', method: 'GET' }, permission), signal, async () => new Response(large, { status: 200 }))).body).toHaveLength(httpResponseBodyBytes)
  await expect(requestHttp(parseHttpRequest({ url: 'https://api.example.invalid/items', method: 'GET' }, permission), signal, async () => new Response(`${large}y`, { status: 200 }))).rejects.toThrow('delivery may be uncertain')
})

it('mints a DDISA agent token from the assigned key, caches it per credential and forgets rejected tokens', async () => {
  const authentication = parseHttpAuthentication({ type: 'ddisaAgent', credential: 'agent_key', subject: 'agent@id.example.com', issuer: 'https://id.example.com' })
  expect(() => parseHttpAuthentication({ ...authentication, issuer: 'http://id.example.com' })).toThrow('HTTPS')
  expect(() => parseHttpAuthentication({ ...authentication, credential: 'Key' })).toThrow('Credential aliases')
  const keys = generateKeyPairSync('ed25519')
  const pem = keys.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()
  let issued = 0
  const transport = vi.fn(async (url: string, options: RequestInit) => {
    const body = JSON.parse(String(options.body)) as { grant_type: string, client_assertion: string }
    const [header, payload, signature] = body.client_assertion.split('.') as [string, string, string]
    expect(verify(null, Buffer.from(`${header}.${payload}`), keys.publicKey, Buffer.from(signature, 'base64url'))).toBe(true)
    expect(JSON.parse(Buffer.from(payload, 'base64url').toString())).toMatchObject({ iss: authentication.subject, sub: authentication.subject, aud: 'https://id.example.com/token' })
    expect([url, body.grant_type, options.redirect]).toEqual(['https://id.example.com/token', 'client_credentials', 'error'])
    return new Response(JSON.stringify({ access_token: `token-${++issued}`, expires_in: 3600 }), { status: 200 })
  })
  let now = 1_000_000
  const tokens = new DdisaAgentTokens(transport, () => now)
  const readKey = vi.fn(async () => pem)
  const signal = new AbortController().signal
  expect(await tokens.bearer('pod-a', authentication, 'credential-1', readKey, signal)).toBe('token-1')
  expect(await tokens.bearer('pod-a', authentication, 'credential-1', readKey, signal)).toBe('token-1')
  expect(await tokens.bearer('pod-a', authentication, 'credential-2', readKey, signal)).toBe('token-2')
  expect(await tokens.bearer('pod-b', authentication, 'credential-2', readKey, signal)).toBe('token-3')
  tokens.reject('pod-a', authentication)
  expect(await tokens.bearer('pod-a', authentication, 'credential-2', readKey, signal)).toBe('token-4')
  now += 3600 * 1000 - 30_000
  expect(await tokens.bearer('pod-a', authentication, 'credential-2', readKey, signal)).toBe('token-5')
  const refused = new DdisaAgentTokens(async () => new Response('{}', { status: 401 }), () => now)
  await expect(refused.bearer('pod-a', authentication, 'credential-2', readKey, signal)).rejects.toThrow('authentication failed (401)')
})
