import type { OpenApeCliAuthorizationDetail, OpenApeGrant } from '@openape/core'
import { InMemoryGrantStore } from '@openape/grants'
import { beforeEach, describe, expect, it, vi } from 'vitest'

let grantStore = new InMemoryGrantStore()
const readBodyMock = vi.fn()
const routerParamMock = vi.fn()

vi.mock('h3', () => ({
  defineEventHandler: (fn: any) => fn,
  readBody: (...args: any[]) => readBodyMock(...args),
  getRouterParam: (...args: any[]) => routerParamMock(...args),
  getRequestHeader: vi.fn(),
  setResponseHeader: vi.fn(),
  setResponseStatus: vi.fn(),
  createError: (opts: any) =>
    Object.assign(new Error(opts.statusMessage), { statusCode: opts.statusCode, data: opts.data }),
}))

vi.mock('../src/runtime/server/utils/admin', () => ({
  requireAuth: vi.fn(async () => 'admin@example.com'),
}))

vi.mock('../src/runtime/server/utils/grant-stores', () => ({
  useGrantStores: () => ({ grantStore }),
}))

vi.mock('../src/runtime/server/utils/stores', () => ({
  getIdpIssuer: () => 'https://id.openape.at',
  useIdpStores: () => ({
    userStore: {
      findByEmail: async (email: string) => ({ email, owner: undefined, approver: 'admin@example.com' }),
    },
    keyStore: {
      getSigningKey: async () => {
        const keyPair = await crypto.subtle.generateKey(
          { name: 'Ed25519', namedCurve: 'Ed25519' } as unknown as EcKeyGenParams,
          true,
          ['sign', 'verify'],
        )
        return {
          kid: 'test-kid',
          privateKey: keyPair.privateKey,
          publicKey: keyPair.publicKey,
        }
      },
    },
  }),
}))

vi.mock('nitropack/runtime', () => ({
  useRuntimeConfig: () => ({ openapeIdp: {} }),
  useEvent: vi.fn(),
  useStorage: vi.fn(),
}))

function fsDetail(path: string): OpenApeCliAuthorizationDetail {
  return {
    type: 'openape_cli',
    cli_id: 'rm',
    operation_id: 'rm.delete',
    resource_chain: [{ resource: 'filesystem', selector: { path } }],
    action: 'delete',
    permission: `rm.filesystem[path=${path}]#delete`,
    display: `Remove ${path}`,
    risk: 'medium',
  }
}

async function createPending(path: string): Promise<OpenApeGrant> {
  const grant: OpenApeGrant = {
    id: 'pending-widen-1',
    status: 'pending',
    created_at: Math.floor(Date.now() / 1000),
    request: {
      requester: 'agent@example.com',
      target_host: 'macmini',
      audience: 'shapes',
      grant_type: 'once',
      authorization_details: [fsDetail(path)],
      command: ['rm', path],
      cmd_hash: 'SHA-256:dummy',
    },
  }
  await grantStore.save(grant)
  return grant
}

describe('grant approve endpoint — widened_details', () => {
  beforeEach(() => {
    grantStore = new InMemoryGrantStore()
    readBodyMock.mockReset()
    routerParamMock.mockReset()
    routerParamMock.mockReturnValue('pending-widen-1')
  })

  it('replaces pending details with widened ones before approving', async () => {
    await createPending('/tmp/foo.txt')

    // Request /tmp/** which covers /tmp/foo.txt — NOT; selector equality semantics
    // in cliAuthorizationDetailCovers require explicit coverage. Use wildcard.
    const wild: OpenApeCliAuthorizationDetail = {
      type: 'openape_cli',
      cli_id: 'rm',
      operation_id: 'rm.delete',
      resource_chain: [{ resource: 'filesystem' }],
      action: 'delete',
      permission: 'rm.filesystem[*]#delete',
      display: 'Remove any file',
      risk: 'medium',
    }

    readBodyMock.mockResolvedValue({
      grant_type: 'always',
      widened_details: [wild],
    })

    const { default: handler } = await import(
      '../src/runtime/server/api/grants/[id]/approve.post',
    )
    const result = await handler({} as any)

    expect(result.grant.status).toBe('approved')
    const detail = result.grant.request.authorization_details[0] as OpenApeCliAuthorizationDetail
    expect(detail.resource_chain[0].selector).toBeUndefined()
    expect(detail.permission).toBe('rm.filesystem[*]#delete')
    expect(result.grant.request.command).toBeUndefined()
    expect(result.grant.request.cmd_hash).toBeUndefined()
    expect(result.authz_jwt).toBeTruthy()
  })

  it('rejects when widened_details and extend_mode are both set', async () => {
    await createPending('/tmp/foo.txt')

    readBodyMock.mockResolvedValue({
      grant_type: 'once',
      widened_details: [fsDetail('/tmp/foo.txt')],
      extend_mode: 'widen',
      extend_grant_ids: ['some-id'],
    })

    const { default: handler } = await import(
      '../src/runtime/server/api/grants/[id]/approve.post',
    )
    await expect(handler({} as any)).rejects.toMatchObject({ statusCode: 400 })
  })

  it('rejects a widened_detail that does not cover the original', async () => {
    await createPending('/tmp/foo.txt')

    readBodyMock.mockResolvedValue({
      grant_type: 'once',
      widened_details: [fsDetail('/etc/passwd')],
    })

    const { default: handler } = await import(
      '../src/runtime/server/api/grants/[id]/approve.post',
    )
    await expect(handler({} as any)).rejects.toMatchObject({ statusCode: 400 })
  })

  it('ignores empty widened_details array and uses normal approve flow', async () => {
    await createPending('/tmp/foo.txt')

    readBodyMock.mockResolvedValue({
      grant_type: 'once',
      widened_details: [],
    })

    const { default: handler } = await import(
      '../src/runtime/server/api/grants/[id]/approve.post',
    )
    const result = await handler({} as any)
    expect(result.grant.status).toBe('approved')
    // Details remain unchanged because widened_details was empty
    const detail = result.grant.request.authorization_details[0] as OpenApeCliAuthorizationDetail
    expect(detail.resource_chain[0].selector).toEqual({ path: '/tmp/foo.txt' })
  })
})

describe('grant GET endpoint — widening_suggestions attachment', () => {
  beforeEach(() => {
    grantStore = new InMemoryGrantStore()
    routerParamMock.mockReset()
    routerParamMock.mockReturnValue('pending-get-1')
  })

  it('attaches widening_suggestions to pending CLI grants', async () => {
    const grant: OpenApeGrant = {
      id: 'pending-get-1',
      status: 'pending',
      created_at: Math.floor(Date.now() / 1000),
      request: {
        requester: 'agent@example.com',
        target_host: 'macmini',
        audience: 'shapes',
        grant_type: 'once',
        authorization_details: [fsDetail('/tmp/foo.txt')],
      },
    }
    await grantStore.save(grant)

    const { default: handler } = await import('../src/runtime/server/api/grants/[id].get')
    const result = await handler({} as any) as any

    expect(result.widening_suggestions).toBeDefined()
    expect(result.widening_suggestions).toHaveLength(1)
    const suggestions = result.widening_suggestions[0]
    expect(suggestions[0].scope).toBe('exact')
    expect(suggestions.at(-1).scope).toBe('wildcard')
    expect(suggestions.map((s: any) => s.scope)).toContain('subtree')
  })

  it('does not attach widening_suggestions for approved grants', async () => {
    const grant: OpenApeGrant = {
      id: 'pending-get-1',
      status: 'approved',
      created_at: Math.floor(Date.now() / 1000),
      decided_at: Math.floor(Date.now() / 1000),
      request: {
        requester: 'agent@example.com',
        target_host: 'macmini',
        audience: 'shapes',
        grant_type: 'once',
        authorization_details: [fsDetail('/tmp/foo.txt')],
      },
    }
    await grantStore.save(grant)

    const { default: handler } = await import('../src/runtime/server/api/grants/[id].get')
    const result = await handler({} as any) as any

    expect(result.widening_suggestions).toBeUndefined()
  })
})
