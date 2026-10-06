import { randomUUID } from 'node:crypto'
import { afterEach, expect, it, vi } from 'vitest'
import { exportJWK, generateKeyPair, SignJWT } from 'jose'
import { challenge, generateKey, publicKey } from '@openape/pods-protocol/crypto'
import { RelayStore } from '../server/utils/store'
import { RelayAuth } from '../server/utils/auth'
import { publicJson } from '../server/utils/public-json'

vi.mock('../server/utils/public-json', () => ({ publicJson: vi.fn() }))
afterEach(() => { vi.resetAllMocks() })
it('uses signed issuer and opaque subject as owner and applies the allowlist to that identity', async () => {
  const keys = await generateKeyPair('EdDSA')
  const jwks = { keys: [{ ...await exportJWK(keys.publicKey), kid: 'fixture', alg: 'EdDSA' }] }
  const issuer = 'https://identity.example'
  const origin = 'https://relay.example'
  const owner = { issuer, subject: 'stable-owner-id' }
  const store = new RelayStore(':memory:')
  const auth = new RelayAuth(store, origin, issuer, actual => actual.issuer === owner.issuer && actual.subject === owner.subject)
  const deviceKey = publicKey(generateKey())
  try {
    for (const subject of [owner.subject, 'different-owner-id']) {
      vi.mocked(publicJson).mockResolvedValue(jwks)
      const flow = auth.begin({ deviceId: randomUUID(), kind: 'mobile', email: 'hint@example.test', keys: { signing: deviceKey, agreement: deviceKey }, challenge: challenge('synthetic-verifier') })
      const browser = await auth.start(flow.id)
      const url = new URL(browser.url)
      const now = Math.floor(Date.now() / 1000)
      const assertion = await new SignJWT({ act: 'human', nonce: url.searchParams.get('nonce') }).setProtectedHeader({ alg: 'EdDSA', kid: 'fixture' }).setIssuer(issuer).setAudience(new URL(origin).host).setSubject(subject).setIssuedAt(now).setExpirationTime(now + 60).sign(keys.privateKey)
      vi.mocked(publicJson).mockImplementation(async endpoint => endpoint.pathname === '/token' ? { assertion } : jwks)
      const callback = auth.callback(url.searchParams.get('state')!, 'synthetic-code', browser.browserSecret)
      if (subject === owner.subject) {
        await expect(callback).resolves.toMatchObject({ id: flow.id, kind: 'mobile' })
        expect(JSON.parse(String(store.db.prepare('SELECT body FROM auth_flows WHERE id=?').get(flow.id)?.body)).owner).toEqual(owner)
      }
      else { await expect(callback).rejects.toThrow('enrollment_closed') }
    }
  }
  finally { store.close() }
})
