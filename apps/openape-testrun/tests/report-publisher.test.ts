import { exportJWK, generateKeyPair, SignJWT } from 'jose'
import { afterEach, beforeAll, expect, it, vi } from 'vitest'
import { verifyReportPublisher } from '../server/utils/report-auth'

const subject = 'publisher@example.com'; const issuer = 'https://idp.example.com'
let keys: Awaited<ReturnType<typeof generateKeyPair>>
beforeAll(async () => { keys = await generateKeyPair('EdDSA') })
afterEach(() => vi.unstubAllGlobals())
async function setup() {
  vi.stubGlobal('resolveIssuerForToken', async () => ({ sub: subject, issuer, jwksUri: `${issuer}/.well-known/jwks.json` }))
  vi.stubGlobal('assertSafeIdpUrl', async () => {})
  vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ keys: [{ ...await exportJWK(keys.publicKey), kid: 'fixture' }] })))
}
async function token(changes: Record<string, unknown> = {}) {
  return await new SignJWT({ sub: subject, iss: issuer, aud: 'apes-cli', act: 'agent', iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 3600, ...changes }).setProtectedHeader({ alg: 'EdDSA', kid: 'fixture' }).sign(keys.privateKey)
}
it('accepts only the exact verified direct publisher identity', async () => {
  await setup()
  expect(await verifyReportPublisher(await token(), subject)).toBe(subject)
})
it.each([{ sub: 'other@example.com' }, { iss: 'https://evil.example' }, { aud: 'other-sp' }, { exp: 1 }, { exp: undefined }, { act: 'human' }, { act: { sub: 'delegate@example.com' } }, { scope: [] }, { delegation_grant: 'revoked' }])('rejects invalid or delegated claims: %j', async (claims) => {
  await setup()
  await expect(verifyReportPublisher(await token(claims), subject)).rejects.toMatchObject({ statusCode: 401 })
})
it('refuses an invalid signature', async () => {
  await setup()
  const valid = await token()
  const parts = valid.split('.'); parts[2] = `${parts[2]![0] === 'A' ? 'B' : 'A'}${parts[2]!.slice(1)}`
  await expect(verifyReportPublisher(parts.join('.'), subject)).rejects.toMatchObject({ statusCode: 401 })
})
