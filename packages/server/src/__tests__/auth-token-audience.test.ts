import { decodeJwt, generateKeyPair } from 'jose'
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_CLI_AUDIENCE,
  issueAuthToken,
  verifyAuthToken,
} from '../idp/utils/auth-token.js'

const ISSUER = 'https://id.openape.test'

async function getKeys() {
  return await generateKeyPair('EdDSA')
}

describe('idp/utils/auth-token audience', () => {
  it('exports DEFAULT_CLI_AUDIENCE = apes-cli', () => {
    expect(DEFAULT_CLI_AUDIENCE).toBe('apes-cli')
  })

  it('issueAuthToken defaults aud to apes-cli', async () => {
    const { privateKey } = await getKeys()
    const token = await issueAuthToken(
      { sub: 'me@example.com', act: 'human' },
      ISSUER,
      privateKey,
    )
    expect(decodeJwt(token).aud).toBe('apes-cli')
  })

  it('issueAuthToken honors explicit aud', async () => {
    const { privateKey } = await getKeys()
    const token = await issueAuthToken(
      { sub: 'me@example.com', act: 'agent', aud: 'sp.example' },
      ISSUER,
      privateKey,
    )
    expect(decodeJwt(token).aud).toBe('sp.example')
  })

  it('verifyAuthToken accepts matching expectedAud', async () => {
    const { privateKey, publicKey } = await getKeys()
    const token = await issueAuthToken(
      { sub: 'me@example.com', act: 'agent' },
      ISSUER,
      privateKey,
    )
    const result = await verifyAuthToken(token, ISSUER, publicKey, 'apes-cli')
    expect(result.act).toBe('agent')
    expect(result.aud).toBe('apes-cli')
  })

  it('verifyAuthToken rejects mismatched expectedAud', async () => {
    const { privateKey, publicKey } = await getKeys()
    const token = await issueAuthToken(
      { sub: 'me@example.com', act: 'agent' },
      ISSUER,
      privateKey,
    )
    await expect(
      verifyAuthToken(token, ISSUER, publicKey, 'wrong-aud'),
    ).rejects.toThrow()
  })

  it('verifyAuthToken without expectedAud accepts any aud', async () => {
    const { privateKey, publicKey } = await getKeys()
    const token = await issueAuthToken(
      { sub: 'me@example.com', act: 'agent', aud: 'arbitrary' },
      ISSUER,
      privateKey,
    )
    const result = await verifyAuthToken(token, ISSUER, publicKey)
    expect(result.aud).toBe('arbitrary')
  })
})
