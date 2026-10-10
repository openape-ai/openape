// @vitest-environment node
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { getAuthFile } from '@openape/cli-auth'
import { apesLogin } from '../../src/main/connections/apes-login'

// Reads the owner's apes login the way Pods does in production, against a temporary
// apes config directory only: the developer's own apes login is never read or written.
let home = ''; const previous = process.env.OPENAPE_CLI_AUTH_HOME
beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'pods-apes-login-'))
  process.env.OPENAPE_CLI_AUTH_HOME = home
  expect(getAuthFile()).toBe(join(home, 'auth.json'))
})
afterEach(async () => {
  if (previous === undefined) delete process.env.OPENAPE_CLI_AUTH_HOME
  else process.env.OPENAPE_CLI_AUTH_HOME = previous
  await rm(home, { recursive: true, force: true })
})
const now = () => Math.floor(Date.now() / 1000)
const store = (value: unknown) => writeFile(join(home, 'auth.json'), typeof value === 'string' ? value : JSON.stringify(value), { mode: 0o600 })
const signal = () => new AbortController().signal

it('returns the current human apes token and reports the login until apes logout empties it', async () => {
  await store({ idp: 'https://identity.example.invalid', access_token: 'current', refresh_token: 'refresh', email: 'Owner@Example.invalid', expires_at: now() + 600 })
  expect(await apesLogin.token(signal())).toEqual({ issuer: 'https://identity.example.invalid', accessToken: 'current' })
  expect(apesLogin.signedIn('https://identity.example.invalid', 'owner@example.invalid')).toBe(true)
  expect(apesLogin.signedIn('https://identity.example.invalid', 'foreign@example.invalid')).toBe(false)
  expect(apesLogin.signedIn('https://foreign.example.invalid', 'owner@example.invalid')).toBe(false)
  // `apes logout` leaves an empty auth.json.
  await store('')
  expect(await apesLogin.token(signal())).toBeNull()
  expect(apesLogin.signedIn('https://identity.example.invalid', 'owner@example.invalid')).toBe(false)
})

it('renews an expired human login through cli-auth under the apes lock and never renews an agent login', async () => {
  const bodies: string[] = []; let idp = ''
  const server = createServer((request, response) => {
    let body = ''
    request.on('data', (chunk: Buffer) => { body += chunk.toString() })
    request.on('end', () => {
      response.setHeader('Content-Type', 'application/json')
      if (request.url === '/.well-known/openid-configuration') { response.end(JSON.stringify({ token_endpoint: `${idp}/token` })); return }
      bodies.push(body)
      if (body.includes('refresh_token=revoked')) { response.statusCode = 400; response.end('{"error":"invalid_grant"}'); return }
      response.end(JSON.stringify({ access_token: 'renewed', refresh_token: 'rotated', expires_in: 300 }))
    })
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  idp = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  try {
    await store({ idp, access_token: 'expired', refresh_token: 'refresh', email: 'owner@example.invalid', expires_at: now() - 10 })
    expect(await apesLogin.token(signal())).toEqual({ issuer: idp, accessToken: 'renewed' })
    expect(JSON.parse(await readFile(join(home, 'auth.json'), 'utf8'))).toMatchObject({ access_token: 'renewed', refresh_token: 'rotated', email: 'owner@example.invalid' })
    await expect(access(join(home, 'auth.json.lock'))).rejects.toThrow()
    // While apes holds its lock, Pods does not refresh and only reads what apes stores.
    await store({ idp, access_token: 'expired', refresh_token: 'refresh', email: 'owner@example.invalid', expires_at: now() - 10 })
    await writeFile(join(home, 'auth.json.lock'), '')
    const waiting = apesLogin.token(signal())
    await store({ idp, access_token: 'from-apes', refresh_token: 'apes-rotated', email: 'owner@example.invalid', expires_at: now() + 300 })
    expect(await waiting).toEqual({ issuer: idp, accessToken: 'from-apes' })
    await rm(join(home, 'auth.json.lock'))
    expect(bodies).toHaveLength(1)
    // A refresh token the IdP refused is a logged-out apes; agent logins are never renewed here.
    await store({ idp, access_token: 'expired', refresh_token: 'revoked', email: 'owner@example.invalid', expires_at: now() - 10 })
    expect(await apesLogin.token(signal())).toBeNull()
    await store({ idp, access_token: 'expired', email: 'agent@example.invalid', key_path: join(home, 'agent-key'), expires_at: now() - 10 })
    expect(await apesLogin.token(signal())).toBeNull()
    expect(bodies).toHaveLength(2)
  }
  finally { await new Promise<void>(resolve => server.close(() => resolve())) }
})
