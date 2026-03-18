import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import * as jose from 'jose'
import { LocalJwtSigner } from '../../src/local/local-jwt.js'
import type { GrantRecord } from '../../src/types.js'
import type { OpenApeCliAuthorizationDetail, OpenApeExecutionContext } from '@openape/core'

describe('LocalJwtSigner', () => {
  let tempDir: string
  let signer: LocalJwtSigner

  beforeEach(async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'local-jwt-'))
    signer = new LocalJwtSigner(tempDir)
    await signer.init()
  })

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true })
  })

  it('generates key pair on init', async () => {
    const jwks = await signer.getJwks()
    expect(jwks.keys).toHaveLength(1)
    expect(jwks.keys[0]!.kty).toBe('OKP')
    expect(jwks.keys[0]!.crv).toBe('Ed25519')
    expect(jwks.keys[0]!.use).toBe('sig')
    expect(jwks.keys[0]!.kid).toBeDefined()
  })

  it('reloads existing key pair', async () => {
    const jwks1 = await signer.getJwks()

    const signer2 = new LocalJwtSigner(tempDir)
    await signer2.init()
    const jwks2 = await signer2.getJwks()

    expect(jwks2.keys[0]!.kid).toBe(jwks1.keys[0]!.kid)
  })

  it('signs a grant JWT', async () => {
    const grant: GrantRecord = {
      id: 'test-grant',
      permission: 'gh.owner[login=openape].repo[*]#list',
      approval: 'once',
      status: 'approved',
      command: 'gh repo list openape',
      risk: 'low',
      display: 'List repos',
      createdAt: new Date().toISOString(),
    }

    const detail: OpenApeCliAuthorizationDetail = {
      type: 'openape_cli',
      cli_id: 'gh',
      operation_id: 'repo.list',
      resource_chain: [{ resource: 'owner', selector: { login: 'openape' } }, { resource: 'repo' }],
      action: 'list',
      permission: 'gh.owner[login=openape].repo[*]#list',
      display: 'List repos',
      risk: 'low',
    }

    const executionContext: OpenApeExecutionContext = {
      argv: ['gh', 'repo', 'list', 'openape'],
      argv_hash: 'SHA-256:abc123',
      adapter_id: 'gh',
      adapter_version: '1',
      adapter_digest: 'SHA-256:def456',
      resolved_executable: 'gh',
      context_bindings: { owner: 'openape' },
    }

    const jwt = await signer.signGrant({
      grant,
      audience: 'openclaw',
      detail,
      executionContext,
    })

    expect(jwt).toBeDefined()
    expect(typeof jwt).toBe('string')

    // Verify JWT structure
    const decoded = jose.decodeJwt(jwt)
    expect(decoded.iss).toBe('local://openclaw-grants')
    expect(decoded.aud).toBe('openclaw')
    expect(decoded.sub).toBe('local-agent')
    expect(decoded.grant_id).toBe('test-grant')
    expect(decoded.grant_type).toBe('once')
    expect(decoded.permissions).toEqual(['gh.owner[login=openape].repo[*]#list'])
  })

  it('signs with correct expiration for once grants (5m)', async () => {
    const grant: GrantRecord = {
      id: 'once-grant',
      permission: 'test#exec',
      approval: 'once',
      status: 'approved',
      command: 'test',
      risk: 'low',
      display: 'Test',
      createdAt: new Date().toISOString(),
    }

    const jwt = await signer.signGrant({
      grant,
      audience: 'openclaw',
      detail: { type: 'openape_cli', cli_id: 'test', operation_id: 'exec', resource_chain: [], action: 'exec', permission: 'test#exec', display: 'Test', risk: 'low' },
      executionContext: { argv: ['test'], argv_hash: 'SHA-256:x', adapter_id: 'test', adapter_version: '1', adapter_digest: 'SHA-256:y', resolved_executable: 'test', context_bindings: {} },
    })

    const decoded = jose.decodeJwt(jwt)
    const exp = decoded.exp as number
    const iat = decoded.iat as number
    // once = 5 minutes
    expect(exp - iat).toBeLessThanOrEqual(300 + 5) // allow 5s clock drift
    expect(exp - iat).toBeGreaterThanOrEqual(295)
  })

  it('JWKS can verify signed JWTs', async () => {
    const grant: GrantRecord = {
      id: 'verify-grant',
      permission: 'test#exec',
      approval: 'always',
      status: 'approved',
      command: 'test',
      risk: 'low',
      display: 'Test',
      createdAt: new Date().toISOString(),
    }

    const jwt = await signer.signGrant({
      grant,
      audience: 'openclaw',
      detail: { type: 'openape_cli', cli_id: 'test', operation_id: 'exec', resource_chain: [], action: 'exec', permission: 'test#exec', display: 'Test', risk: 'low' },
      executionContext: { argv: ['test'], argv_hash: 'SHA-256:x', adapter_id: 'test', adapter_version: '1', adapter_digest: 'SHA-256:y', resolved_executable: 'test', context_bindings: {} },
    })

    // Get public key from JWKS
    const jwks = await signer.getJwks()
    const pubKey = await jose.importJWK(jwks.keys[0]!, 'EdDSA')

    const { payload } = await jose.jwtVerify(jwt, pubKey, {
      issuer: 'local://openclaw-grants',
      audience: 'openclaw',
    })

    expect(payload.grant_id).toBe('verify-grant')
  })

  it('returns correct issuer', () => {
    expect(signer.getIssuer()).toBe('local://openclaw-grants')
  })
})
