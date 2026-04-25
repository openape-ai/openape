import { decodeJwt, generateKeyPair } from 'jose'
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_CLI_AUDIENCE,
  issueAgentToken,
  issueAuthToken,
  verifyAgentToken,
  verifyAuthToken,
} from '../src/runtime/server/utils/agent-token'

const ISSUER = 'https://id.openape.test'

async function getKeys() {
  return await generateKeyPair('EdDSA')
}

describe('agent-token audience defaults', () => {
  it('issueAuthToken defaults aud to DEFAULT_CLI_AUDIENCE', async () => {
    const { privateKey } = await getKeys()
    const token = await issueAuthToken(
      { sub: 'me@example.com', act: 'human' },
      ISSUER,
      privateKey,
    )
    const payload = decodeJwt(token)
    expect(payload.aud).toBe(DEFAULT_CLI_AUDIENCE)
    expect(DEFAULT_CLI_AUDIENCE).toBe('apes-cli')
  })

  it('issueAuthToken honors explicit aud override', async () => {
    const { privateKey } = await getKeys()
    const token = await issueAuthToken(
      { sub: 'me@example.com', act: 'agent', aud: 'custom-audience' },
      ISSUER,
      privateKey,
    )
    const payload = decodeJwt(token)
    expect(payload.aud).toBe('custom-audience')
  })

  it('issueAgentToken sets aud=apes-cli by default', async () => {
    const { privateKey } = await getKeys()
    const token = await issueAgentToken(
      { sub: 'agent@example.com' },
      ISSUER,
      privateKey,
    )
    const payload = decodeJwt(token)
    expect(payload.aud).toBe(DEFAULT_CLI_AUDIENCE)
    expect(payload.act).toBe('agent')
  })

  it('verifyAuthToken accepts a token without expectedAud', async () => {
    const { privateKey, publicKey } = await getKeys()
    const token = await issueAuthToken(
      { sub: 'me@example.com', act: 'human' },
      ISSUER,
      privateKey,
    )
    const result = await verifyAuthToken(token, ISSUER, publicKey)
    expect(result.sub).toBe('me@example.com')
    expect(result.aud).toBe(DEFAULT_CLI_AUDIENCE)
  })

  it('verifyAuthToken accepts a matching expectedAud', async () => {
    const { privateKey, publicKey } = await getKeys()
    const token = await issueAuthToken(
      { sub: 'me@example.com', act: 'human' },
      ISSUER,
      privateKey,
    )
    const result = await verifyAuthToken(token, ISSUER, publicKey, 'apes-cli')
    expect(result.aud).toBe('apes-cli')
  })

  it('verifyAuthToken rejects a mismatched expectedAud', async () => {
    const { privateKey, publicKey } = await getKeys()
    const token = await issueAuthToken(
      { sub: 'me@example.com', act: 'human' },
      ISSUER,
      privateKey,
    )
    await expect(
      verifyAuthToken(token, ISSUER, publicKey, 'something-else'),
    ).rejects.toThrow()
  })

  it('verifyAgentToken honors expectedAud', async () => {
    const { privateKey, publicKey } = await getKeys()
    const token = await issueAgentToken(
      { sub: 'agent@example.com' },
      ISSUER,
      privateKey,
    )
    const result = await verifyAgentToken(token, ISSUER, publicKey, 'apes-cli')
    expect(result.act).toBe('agent')
    expect(result.aud).toBe('apes-cli')
    await expect(
      verifyAgentToken(token, ISSUER, publicKey, 'wrong-aud'),
    ).rejects.toThrow()
  })
})
