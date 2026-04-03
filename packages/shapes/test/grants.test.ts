import { beforeEach, describe, expect, it, vi } from 'vitest'

const apiFetchMock = vi.fn()
const discoverEndpointsMock = vi.fn()
const getGrantsEndpointMock = vi.fn()
const getRequesterIdentityMock = vi.fn()
const verifyAuthzJWTMock = vi.fn()
const execFileSyncMock = vi.fn()

vi.mock('../src/http.js', () => ({
  apiFetch: (...args: unknown[]) => apiFetchMock(...args),
  discoverEndpoints: (...args: unknown[]) => discoverEndpointsMock(...args),
  getGrantsEndpoint: (...args: unknown[]) => getGrantsEndpointMock(...args),
}))

vi.mock('../src/config.js', () => ({
  getRequesterIdentity: (...args: unknown[]) => getRequesterIdentityMock(...args),
}))

vi.mock('@openape/grants', async importOriginal => ({
  ...await importOriginal<typeof import('@openape/grants')>(),
  verifyAuthzJWT: (...args: unknown[]) => verifyAuthzJWTMock(...args),
}))

vi.mock('node:child_process', () => ({
  execFileSync: (...args: unknown[]) => execFileSyncMock(...args),
}))

function buildResolved() {
  return {
    adapter: {
      schema: 'openape-shapes/v1',
      cli: {
        id: 'gh',
        executable: 'gh',
        audience: 'shapes',
      },
      operations: [],
    },
    source: 'bundled:gh',
    digest: 'SHA-256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    executable: 'gh',
    commandArgv: ['repo', 'list', 'openape'],
    bindings: { owner: 'openape' },
    detail: {
      type: 'openape_cli' as const,
      cli_id: 'gh',
      operation_id: 'repo.list',
      resource_chain: [
        { resource: 'owner', selector: { login: 'openape' } },
        { resource: 'repo' },
      ],
      action: 'list',
      permission: 'gh.owner[login=openape].repo[*]#list',
      display: 'List repositories for owner openape',
      risk: 'low' as const,
    },
    executionContext: {
      argv: ['gh', 'repo', 'list', 'openape'],
      argv_hash: 'SHA-256:argvhash',
      adapter_id: 'gh',
      adapter_version: 'openape-shapes/v1',
      adapter_digest: 'SHA-256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      resolved_executable: 'gh',
      context_bindings: { owner: 'openape' },
    },
    permission: 'gh.owner[login=openape].repo[*]#list',
  }
}

function buildJwt(payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url')
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url')
  return `${header}.${body}.signature`
}

describe('@openape/shapes grants', () => {
  beforeEach(() => {
    apiFetchMock.mockReset()
    discoverEndpointsMock.mockReset()
    getGrantsEndpointMock.mockReset()
    getRequesterIdentityMock.mockReset()
    verifyAuthzJWTMock.mockReset()
    execFileSyncMock.mockReset()
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('creates a structured CLI grant request', async () => {
    const resolved = buildResolved()
    getRequesterIdentityMock.mockReturnValue('agent@example.com')
    getGrantsEndpointMock.mockResolvedValue('https://idp.example.com/api/grants')
    apiFetchMock.mockResolvedValue({ id: 'grant-1', status: 'pending' })

    const { createShapesGrant } = await import('../src/grants.js')
    const grant = await createShapesGrant(resolved as any, {
      idp: 'https://idp.example.com',
      approval: 'once',
      reason: 'Need repo visibility',
    })

    expect(grant).toEqual({ id: 'grant-1', status: 'pending' })
    expect(apiFetchMock).toHaveBeenCalledWith(
      'https://idp.example.com/api/grants',
      expect.objectContaining({
        method: 'POST',
        idp: 'https://idp.example.com',
        body: expect.objectContaining({
          requester: 'agent@example.com',
          audience: 'shapes',
          grant_type: 'once',
          command: ['gh', 'repo', 'list', 'openape'],
          permissions: ['gh.owner[login=openape].repo[*]#list'],
          authorization_details: [resolved.detail],
          execution_context: resolved.executionContext,
          reason: 'Need repo visibility',
        }),
      }),
    )
  })

  it('polls until a grant is approved', async () => {
    vi.useFakeTimers()
    getGrantsEndpointMock.mockResolvedValue('https://idp.example.com/api/grants')
    apiFetchMock
      .mockResolvedValueOnce({ status: 'pending' })
      .mockResolvedValueOnce({ status: 'approved' })

    const { waitForGrantStatus } = await import('../src/grants.js')
    const statusPromise = waitForGrantStatus('https://idp.example.com', 'grant-1')

    await Promise.resolve()
    await vi.advanceTimersByTimeAsync(3000)

    await expect(statusPromise).resolves.toBe('approved')
    expect(apiFetchMock).toHaveBeenNthCalledWith(1, 'https://idp.example.com/api/grants/grant-1', { idp: 'https://idp.example.com' })
    expect(apiFetchMock).toHaveBeenNthCalledWith(2, 'https://idp.example.com/api/grants/grant-1', { idp: 'https://idp.example.com' })
  })

  it('fetches the authz token after approval', async () => {
    getGrantsEndpointMock.mockResolvedValue('https://idp.example.com/api/grants')
    apiFetchMock.mockResolvedValue({ authz_jwt: 'header.payload.signature' })

    const { fetchGrantToken } = await import('../src/grants.js')
    const token = await fetchGrantToken('https://idp.example.com', 'grant-1')

    expect(token).toBe('header.payload.signature')
    expect(apiFetchMock).toHaveBeenCalledWith('https://idp.example.com/api/grants/grant-1/token', {
      method: 'POST',
      idp: 'https://idp.example.com',
    })
  })

  it('verifies, consumes, and executes a matching command', async () => {
    const resolved = buildResolved()
    discoverEndpointsMock.mockResolvedValue({
      jwks_uri: 'https://idp.example.com/.well-known/jwks.json',
    })
    verifyAuthzJWTMock.mockResolvedValue({
      valid: true,
      claims: {
        iss: 'https://idp.example.com',
        aud: 'shapes',
        grant_id: 'grant-1',
        permissions: [resolved.permission],
        authorization_details: [resolved.detail],
        execution_context: {
          adapter_digest: resolved.digest,
          argv_hash: resolved.executionContext.argv_hash,
        },
      },
    })
    getGrantsEndpointMock.mockResolvedValue('https://idp.example.com/api/grants')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ status: 'consumed' }),
    }))

    const { verifyAndExecute } = await import('../src/grants.js')
    await verifyAndExecute(buildJwt({ iss: 'https://idp.example.com' }), resolved as any)

    expect(verifyAuthzJWTMock).toHaveBeenCalled()
    expect(execFileSyncMock).toHaveBeenCalledWith('gh', ['repo', 'list', 'openape'], { stdio: 'inherit' })
  })

  it('verifies, consumes, and executes an exact raw command grant', async () => {
    const resolved = buildResolved()
    discoverEndpointsMock.mockResolvedValue({
      jwks_uri: 'https://idp.example.com/.well-known/jwks.json',
    })
    verifyAuthzJWTMock.mockResolvedValue({
      valid: true,
      claims: {
        iss: 'https://idp.example.com',
        aud: 'shapes',
        grant_id: 'grant-1',
        command: ['gh', 'repo', 'list', 'openape'],
      },
    })
    getGrantsEndpointMock.mockResolvedValue('https://idp.example.com/api/grants')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ status: 'consumed' }),
    }))

    const { verifyAndExecute } = await import('../src/grants.js')
    await verifyAndExecute(buildJwt({ iss: 'https://idp.example.com' }), resolved as any)

    expect(execFileSyncMock).toHaveBeenCalledWith('gh', ['repo', 'list', 'openape'], { stdio: 'inherit' })
  })

  it('rejects an exact raw command grant when argv differs', async () => {
    const resolved = buildResolved()
    discoverEndpointsMock.mockResolvedValue({
      jwks_uri: 'https://idp.example.com/.well-known/jwks.json',
    })
    verifyAuthzJWTMock.mockResolvedValue({
      valid: true,
      claims: {
        iss: 'https://idp.example.com',
        aud: 'shapes',
        grant_id: 'grant-1',
        command: ['gh', 'repo', 'view', 'openape'],
      },
    })

    const { verifyAndExecute } = await import('../src/grants.js')
    await expect(
      verifyAndExecute(buildJwt({ iss: 'https://idp.example.com' }), resolved as any),
    ).rejects.toThrow('Granted command does not match current argv')
    expect(execFileSyncMock).not.toHaveBeenCalled()
  })

  it('rejects execution when the granted adapter digest differs', async () => {
    const resolved = buildResolved()
    discoverEndpointsMock.mockResolvedValue({
      jwks_uri: 'https://idp.example.com/.well-known/jwks.json',
    })
    verifyAuthzJWTMock.mockResolvedValue({
      valid: true,
      claims: {
        iss: 'https://idp.example.com',
        aud: 'shapes',
        grant_id: 'grant-1',
        permissions: [resolved.permission],
        authorization_details: [resolved.detail],
        execution_context: {
          adapter_digest: 'SHA-256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
          argv_hash: resolved.executionContext.argv_hash,
        },
      },
    })

    const { verifyAndExecute } = await import('../src/grants.js')
    await expect(verifyAndExecute(buildJwt({ iss: 'https://idp.example.com' }), resolved as any)).rejects.toThrow('Adapter digest mismatch')
    expect(execFileSyncMock).not.toHaveBeenCalled()
  })

  it('skips argv_hash check for always grants without exact_command', async () => {
    const resolved = buildResolved()
    discoverEndpointsMock.mockResolvedValue({
      jwks_uri: 'https://idp.example.com/.well-known/jwks.json',
    })
    verifyAuthzJWTMock.mockResolvedValue({
      valid: true,
      claims: {
        iss: 'https://idp.example.com',
        aud: 'shapes',
        grant_id: 'grant-1',
        grant_type: 'always',
        permissions: [resolved.permission],
        authorization_details: [resolved.detail],
        execution_context: {
          adapter_digest: resolved.digest,
          argv_hash: 'SHA-256:different',
        },
      },
    })
    getGrantsEndpointMock.mockResolvedValue('https://idp.example.com/api/grants')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ status: 'consumed' }),
    }))

    const { verifyAndExecute } = await import('../src/grants.js')
    await verifyAndExecute(buildJwt({ iss: 'https://idp.example.com' }), resolved as any)

    expect(execFileSyncMock).toHaveBeenCalledWith('gh', ['repo', 'list', 'openape'], { stdio: 'inherit' })
  })

  it('enforces argv_hash for once grants', async () => {
    const resolved = buildResolved()
    discoverEndpointsMock.mockResolvedValue({
      jwks_uri: 'https://idp.example.com/.well-known/jwks.json',
    })
    verifyAuthzJWTMock.mockResolvedValue({
      valid: true,
      claims: {
        iss: 'https://idp.example.com',
        aud: 'shapes',
        grant_id: 'grant-1',
        grant_type: 'once',
        permissions: [resolved.permission],
        authorization_details: [resolved.detail],
        execution_context: {
          adapter_digest: resolved.digest,
          argv_hash: 'SHA-256:different',
        },
      },
    })

    const { verifyAndExecute } = await import('../src/grants.js')
    await expect(
      verifyAndExecute(buildJwt({ iss: 'https://idp.example.com' }), resolved as any),
    ).rejects.toThrow('Granted command does not match current argv')
    expect(execFileSyncMock).not.toHaveBeenCalled()
  })

  it('enforces argv_hash for always grants with exact_command constraint', async () => {
    const resolved = buildResolved()
    const detailWithExact = { ...resolved.detail, constraints: { exact_command: true } }
    discoverEndpointsMock.mockResolvedValue({
      jwks_uri: 'https://idp.example.com/.well-known/jwks.json',
    })
    verifyAuthzJWTMock.mockResolvedValue({
      valid: true,
      claims: {
        iss: 'https://idp.example.com',
        aud: 'shapes',
        grant_id: 'grant-1',
        grant_type: 'always',
        permissions: [resolved.permission],
        authorization_details: [detailWithExact],
        execution_context: {
          adapter_digest: resolved.digest,
          argv_hash: 'SHA-256:different',
        },
      },
    })

    const { verifyAndExecute } = await import('../src/grants.js')
    await expect(
      verifyAndExecute(buildJwt({ iss: 'https://idp.example.com' }), resolved as any),
    ).rejects.toThrow('Granted command does not match current argv')
    expect(execFileSyncMock).not.toHaveBeenCalled()
  })

  describe('findExistingGrant', () => {
    it('finds a matching always grant', async () => {
      const resolved = buildResolved()
      getGrantsEndpointMock.mockResolvedValue('https://idp.example.com/api/grants')
      apiFetchMock.mockResolvedValue({
        data: [{
          id: 'grant-reuse-1',
          status: 'approved',
          request: {
            grant_type: 'always',
            audience: 'shapes',
            permissions: [resolved.permission],
            authorization_details: [resolved.detail],
            execution_context: {
              adapter_digest: resolved.digest,
            },
          },
        }],
      })

      const { findExistingGrant } = await import('../src/grants.js')
      const result = await findExistingGrant(resolved as any, 'https://idp.example.com')
      expect(result).toBe('grant-reuse-1')
    })

    it('skips expired timed grants', async () => {
      const resolved = buildResolved()
      getGrantsEndpointMock.mockResolvedValue('https://idp.example.com/api/grants')
      apiFetchMock.mockResolvedValue({
        data: [{
          id: 'grant-expired',
          status: 'approved',
          expires_at: Math.floor(Date.now() / 1000) - 60,
          request: {
            grant_type: 'timed',
            audience: 'shapes',
            permissions: [resolved.permission],
            authorization_details: [resolved.detail],
            execution_context: {
              adapter_digest: resolved.digest,
            },
          },
        }],
      })

      const { findExistingGrant } = await import('../src/grants.js')
      const result = await findExistingGrant(resolved as any, 'https://idp.example.com')
      expect(result).toBeNull()
    })

    it('skips once grants', async () => {
      const resolved = buildResolved()
      getGrantsEndpointMock.mockResolvedValue('https://idp.example.com/api/grants')
      apiFetchMock.mockResolvedValue({
        data: [{
          id: 'grant-once',
          status: 'approved',
          request: {
            grant_type: 'once',
            audience: 'shapes',
            permissions: [resolved.permission],
            authorization_details: [resolved.detail],
            execution_context: {
              adapter_digest: resolved.digest,
            },
          },
        }],
      })

      const { findExistingGrant } = await import('../src/grants.js')
      const result = await findExistingGrant(resolved as any, 'https://idp.example.com')
      expect(result).toBeNull()
    })

    it('skips grants with mismatched adapter digest', async () => {
      const resolved = buildResolved()
      getGrantsEndpointMock.mockResolvedValue('https://idp.example.com/api/grants')
      apiFetchMock.mockResolvedValue({
        data: [{
          id: 'grant-wrong-digest',
          status: 'approved',
          request: {
            grant_type: 'always',
            audience: 'shapes',
            permissions: [resolved.permission],
            authorization_details: [resolved.detail],
            execution_context: {
              adapter_digest: 'SHA-256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
            },
          },
        }],
      })

      const { findExistingGrant } = await import('../src/grants.js')
      const result = await findExistingGrant(resolved as any, 'https://idp.example.com')
      expect(result).toBeNull()
    })
  })
})
