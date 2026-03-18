import { afterEach, describe, expect, it, vi } from 'vitest'
import * as jose from 'jose'
import * as grants from '@openape/grants'
import { handleIdpGrantExec } from '../../src/idp/idp-grants.js'
import { clearDiscoveryCache } from '../../src/idp/discovery.js'
import { GrantStore } from '../../src/store/grant-store.js'
import { GrantCache } from '../../src/store/grant-cache.js'
import { AuditLog } from '../../src/store/audit-log.js'
import type { PluginApi, PluginConfig } from '../../src/types.js'
import { DEFAULT_CONFIG } from '../../src/types.js'
import type { AgentAuthState } from '../../src/idp/auth.js'
import type { ResolvedCommand } from '../../src/adapters/types.js'

function mockApi(): PluginApi {
  return {
    registerTool: vi.fn(),
    on: vi.fn(),
    registerHttpRoute: vi.fn(),
    registerCli: vi.fn(),
    sendChannelMessage: vi.fn(),
    onChannelCommand: vi.fn(),
    runtime: {
      system: {
        runCommandWithTimeout: vi.fn().mockResolvedValue({ stdout: 'ok', stderr: '', exitCode: 0 }),
      },
      config: {
        getStateDir: () => '/tmp/test-state',
        getWorkspaceDir: () => '/tmp/test-workspace',
      },
    },
    log: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    },
  }
}

function getUrl(input: string | URL | Request): string {
  if (typeof input === 'string') return input
  if (input instanceof URL) return input.toString()
  return (input as Request).url
}

describe('handleIdpGrantExec', () => {
  afterEach(() => {
    clearDiscoveryCache()
    vi.restoreAllMocks()
  })

  it('creates grant at IdP, polls for approval, fetches token, and executes', async () => {
    const { privateKey, publicKey } = await jose.generateKeyPair('EdDSA', { crv: 'Ed25519' })
    const pubJwk = await jose.exportJWK(publicKey)
    pubJwk.kid = 'test-kid'
    pubJwk.alg = 'EdDSA'
    pubJwk.use = 'sig'

    const grantJwt = await new jose.SignJWT({
      grant_id: 'idp-grant-1',
      grant_type: 'once',
      permissions: ['gh.owner[login=openape].repo[*]#list'],
      authorization_details: [{
        type: 'openape_cli',
        cli_id: 'gh',
        operation_id: 'repo.list',
        resource_chain: [{ resource: 'owner', selector: { login: 'openape' } }, { resource: 'repo' }],
        action: 'list',
        permission: 'gh.owner[login=openape].repo[*]#list',
        display: 'List repos',
        risk: 'low',
      }],
    })
      .setProtectedHeader({ alg: 'EdDSA', kid: 'test-kid' })
      .setIssuedAt()
      .setIssuer('https://id.openape.at')
      .setAudience('openclaw')
      .setExpirationTime('5m')
      .sign(privateKey)

    // Mock JWT verification (tested separately in @openape/grants)
    vi.spyOn(grants, 'verifyAuthzJWT').mockResolvedValue({
      valid: true,
      claims: {
        iss: 'https://id.openape.at',
        sub: 'agent@openape.at',
        aud: 'openclaw',
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 300,
        jti: 'test-jti',
        grant_id: 'idp-grant-1',
        grant_type: 'once',
        permissions: ['gh.owner[login=openape].repo[*]#list'],
        authorization_details: [{
          type: 'openape_cli',
          cli_id: 'gh',
          operation_id: 'repo.list',
          resource_chain: [{ resource: 'owner', selector: { login: 'openape' } }, { resource: 'repo' }],
          action: 'list',
          permission: 'gh.owner[login=openape].repo[*]#list',
          display: 'List repos',
          risk: 'low',
        }],
      } as any,
    })

    const discoveryResponse = JSON.stringify({
      issuer: 'https://id.openape.at',
      openape_grants_endpoint: 'https://id.openape.at/api/grants',
      jwks_uri: 'https://id.openape.at/.well-known/jwks.json',
    })

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = getUrl(input as string | URL | Request)
      const method = init?.method ?? 'GET'

      if (url.includes('.well-known/openid-configuration')) {
        return new Response(discoveryResponse, { headers: { 'Content-Type': 'application/json' } })
      }

      if (url === 'https://id.openape.at/api/grants' && method === 'POST') {
        return new Response(JSON.stringify({ id: 'idp-grant-1', status: 'pending' }))
      }

      if (url.includes('/idp-grant-1/token') && method === 'POST') {
        return new Response(JSON.stringify({ authz_jwt: grantJwt }))
      }

      if (url.includes('/idp-grant-1')) {
        return new Response(JSON.stringify({ status: 'approved' }))
      }

      return new Response('not found', { status: 404 })
    })

    const api = mockApi()
    const config: PluginConfig = { ...DEFAULT_CONFIG, mode: 'idp' }
    const authState: AgentAuthState = {
      idpUrl: 'https://id.openape.at',
      token: 'agent-token',
      email: 'agent@openape.at',
      expiresAt: Math.floor(Date.now() / 1000) + 3600,
    }

    const resolved: ResolvedCommand = {
      adapter: { schema: 'openape-shapes/v1', cli: { id: 'gh', executable: 'gh' }, operations: [] },
      source: 'gh.toml',
      digest: 'SHA-256:abc',
      executable: 'gh',
      commandArgv: ['repo', 'list', 'openape'],
      bindings: { owner: 'openape' },
      detail: {
        type: 'openape_cli',
        cli_id: 'gh',
        operation_id: 'repo.list',
        resource_chain: [{ resource: 'owner', selector: { login: 'openape' } }, { resource: 'repo' }],
        action: 'list',
        permission: 'gh.owner[login=openape].repo[*]#list',
        display: 'List repos',
        risk: 'low',
      },
      executionContext: {
        argv: ['gh', 'repo', 'list', 'openape'],
        argv_hash: 'SHA-256:xyz',
        adapter_id: 'gh',
        adapter_version: '1',
        adapter_digest: 'SHA-256:abc',
        resolved_executable: 'gh',
        context_bindings: { owner: 'openape' },
      },
      permission: 'gh.owner[login=openape].repo[*]#list',
    }

    const result = await handleIdpGrantExec(
      {
        config,
        api,
        authState,
        store: new GrantStore(),
        cache: new GrantCache(),
        audit: new AuditLog(),
      },
      {
        resolved,
        fallback: null,
        command: 'gh repo list openape',
        reason: 'List repos',
      },
    )

    if (!result.success) {
      console.error('GRANT EXEC ERROR:', result.error)
    }
    expect(result.success).toBe(true)
    expect(api.runtime.system.runCommandWithTimeout).toHaveBeenCalledWith(
      'gh',
      ['repo', 'list', 'openape'],
      expect.any(Object),
    )
  })

  it('returns error when grant is denied by IdP', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = getUrl(input as string | URL | Request)
      const method = init?.method ?? 'GET'

      if (url.includes('.well-known/openid-configuration')) {
        return new Response(JSON.stringify({ openape_grants_endpoint: 'https://id.openape.at/api/grants' }))
      }
      if (url === 'https://id.openape.at/api/grants' && method === 'POST') {
        return new Response(JSON.stringify({ id: 'denied-grant', status: 'pending' }))
      }
      if (url.includes('/denied-grant')) {
        return new Response(JSON.stringify({ status: 'denied' }))
      }
      return new Response('', { status: 404 })
    })

    const api = mockApi()
    const result = await handleIdpGrantExec(
      {
        config: { ...DEFAULT_CONFIG, mode: 'idp' },
        api,
        authState: { idpUrl: 'https://id.openape.at', token: 't', email: 'a@b.c', expiresAt: Math.floor(Date.now() / 1000) + 3600 },
        store: new GrantStore(),
        cache: new GrantCache(),
        audit: new AuditLog(),
      },
      {
        resolved: null,
        fallback: { command: 'foo bar', argv: ['foo', 'bar'], hash: 'SHA-256:x', permission: 'unknown#exec', display: 'Foo bar', risk: 'high' },
        command: 'foo bar',
      },
    )

    expect(result.success).toBe(false)
    expect(result.error).toContain('denied')
  })
})
