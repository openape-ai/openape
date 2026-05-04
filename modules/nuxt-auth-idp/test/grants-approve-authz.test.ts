import type { OpenApeCliAuthorizationDetail, OpenApeGrant } from '@openape/core'
import { InMemoryGrantStore } from '@openape/grants'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// Approver-policy regression suite. Surfaced in the security audit on
// 2026-05-04 (issue #275-area): the previous `isRequester` short-circuit
// in approve.post.ts let any requester self-approve, so an agent armed
// with only its 1h IdP token could mint authz_jwt for arbitrary audiences
// without the human owner's consent. These tests pin the corrected
// approver-policy resolution: explicit approver / owner / implicit-self
// (top-level human only) — never "requester == bearer".

let grantStore = new InMemoryGrantStore()
const readBodyMock = vi.fn()
const routerParamMock = vi.fn()
let mockRequireAuthEmail = 'admin@example.com'
const usersInStore: Map<string, { email: string, owner?: string, approver?: string }> = new Map()

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
  requireAuth: vi.fn(async () => mockRequireAuthEmail),
}))

vi.mock('../src/runtime/server/utils/grant-stores', () => ({
  useGrantStores: () => ({ grantStore }),
}))

vi.mock('../src/runtime/server/utils/stores', () => ({
  getIdpIssuer: () => 'https://id.openape.at',
  useIdpStores: () => ({
    userStore: {
      findByEmail: async (email: string) => usersInStore.get(email),
    },
    keyStore: {
      getSigningKey: async () => {
        const keyPair = await crypto.subtle.generateKey(
          { name: 'Ed25519', namedCurve: 'Ed25519' } as unknown as EcKeyGenParams,
          true,
          ['sign', 'verify'],
        )
        return { kid: 'test-kid', privateKey: keyPair.privateKey, publicKey: keyPair.publicKey }
      },
    },
  }),
}))

vi.mock('nitropack/runtime', () => ({
  useRuntimeConfig: () => ({ openapeIdp: {} }),
  useEvent: vi.fn(),
  useStorage: vi.fn(),
}))

function detail(): OpenApeCliAuthorizationDetail {
  return {
    type: 'openape_cli',
    cli_id: 'rm',
    operation_id: 'rm.delete',
    resource_chain: [{ resource: 'filesystem', selector: { path: '/tmp/x' } }],
    action: 'delete',
    permission: 'rm.filesystem[path=/tmp/x]#delete',
    display: 'Remove /tmp/x',
    risk: 'medium',
  }
}

async function createGrantBy(requester: string): Promise<OpenApeGrant> {
  const g: OpenApeGrant = {
    id: 'grant-approver-test',
    status: 'pending',
    created_at: Math.floor(Date.now() / 1000),
    request: {
      requester,
      target_host: 'macmini',
      audience: 'shapes',
      grant_type: 'once',
      authorization_details: [detail()],
      command: ['rm', '/tmp/x'],
      cmd_hash: 'SHA-256:dummy',
    },
  }
  await grantStore.save(g)
  return g
}

async function importHandler() {
  return (await import('../src/runtime/server/api/grants/[id]/approve.post')).default
}

describe('approve.post authorization', () => {
  beforeEach(() => {
    grantStore = new InMemoryGrantStore()
    usersInStore.clear()
    readBodyMock.mockReset().mockResolvedValue({})
    routerParamMock.mockReset().mockReturnValue('grant-approver-test')
  })

  it('rejects an agent that tries to self-approve its own grant', async () => {
    // Sub-user with an explicit owner (the human) and no separate approver.
    // The agent presents its own bearer (sub === requester); previously the
    // `isRequester` shortcut bypassed the policy and let it self-approve.
    usersInStore.set('agent@example.com', {
      email: 'agent@example.com',
      owner: 'patrick@hofmann.eco',
      approver: undefined,
    })
    await createGrantBy('agent@example.com')
    mockRequireAuthEmail = 'agent@example.com'

    const handler = await importHandler()
    await expect(handler({} as any)).rejects.toMatchObject({ statusCode: 403 })
  })

  it('lets the explicit approver approve a sub-user grant', async () => {
    usersInStore.set('agent@example.com', {
      email: 'agent@example.com',
      owner: 'patrick@hofmann.eco',
      approver: 'security@example.com',
    })
    await createGrantBy('agent@example.com')
    mockRequireAuthEmail = 'security@example.com'

    const handler = await importHandler()
    const result = await handler({} as any)
    expect(result.grant.status).toBe('approved')
  })

  it('lets the owner approve a sub-user grant when approver is unset', async () => {
    // Approver undefined => owner is the implicit approver.
    usersInStore.set('agent@example.com', {
      email: 'agent@example.com',
      owner: 'patrick@hofmann.eco',
      approver: undefined,
    })
    await createGrantBy('agent@example.com')
    mockRequireAuthEmail = 'patrick@hofmann.eco'

    const handler = await importHandler()
    const result = await handler({} as any)
    expect(result.grant.status).toBe('approved')
  })

  it('lets a top-level human approve their own grant (no owner, no approver)', async () => {
    // Implicit-self path: when both owner and approver are undefined the
    // user IS the policy's terminal authority, so self-approval is fine.
    usersInStore.set('patrick@hofmann.eco', {
      email: 'patrick@hofmann.eco',
      owner: undefined,
      approver: undefined,
    })
    await createGrantBy('patrick@hofmann.eco')
    mockRequireAuthEmail = 'patrick@hofmann.eco'

    const handler = await importHandler()
    const result = await handler({} as any)
    expect(result.grant.status).toBe('approved')
  })

  it('rejects approval by an unrelated party', async () => {
    usersInStore.set('agent@example.com', {
      email: 'agent@example.com',
      owner: 'patrick@hofmann.eco',
      approver: undefined,
    })
    await createGrantBy('agent@example.com')
    mockRequireAuthEmail = 'random@stranger.example'

    const handler = await importHandler()
    await expect(handler({} as any)).rejects.toMatchObject({ statusCode: 403 })
  })

  it('still allows the management token to approve regardless of approver-policy', async () => {
    // The management bypass is intentional; a deployment with a known
    // management secret can short-circuit the policy.
    usersInStore.set('agent@example.com', {
      email: 'agent@example.com',
      owner: 'patrick@hofmann.eco',
      approver: undefined,
    })
    await createGrantBy('agent@example.com')
    mockRequireAuthEmail = '_management_'

    const handler = await importHandler()
    const result = await handler({} as any)
    expect(result.grant.status).toBe('approved')
  })
})
