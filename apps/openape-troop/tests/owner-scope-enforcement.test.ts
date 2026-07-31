import type { H3Event } from 'h3'
import { afterEach, describe, expect, it, vi } from 'vitest'

// requireOwner resolved the owner from a CLI token and then DROPPED the token's
// scope — 28 routes (agent secrets, skills, org creation) treated any delegation
// as an unrestricted owner (#1038). These tests pin the two halves of the fix:
// the catalog check now runs, and a human who asked for a narrower scope keeps it.

const { mockVerifyCliToken } = vi.hoisted(() => ({ mockVerifyCliToken: vi.fn() }))
vi.mock('../server/utils/cli-token', () => ({ verifyCliToken: mockVerifyCliToken }))

// Nitro auto-imports resolve via globalThis outside Nuxt.
vi.stubGlobal('getSpSession', async () => ({ data: {} }))
vi.stubGlobal('getHeader', () => 'Bearer stub-token')
vi.stubGlobal('createError', (e: { statusCode: number }) => Object.assign(new Error('http'), e))
vi.stubGlobal('useRuntimeConfig', () => ({ public: { idpUrl: 'https://id.example.test' } }))

const assertScope = vi.fn()
vi.stubGlobal('assertScopeCoversRequest', assertScope)

const { requireOwner, resolveOwnerContext } = await import('../server/utils/auth')

const event = { path: '/api/agents/x/secrets/Y' } as H3Event

afterEach(() => {
  mockVerifyCliToken.mockReset()
  assertScope.mockReset()
})

describe('requireOwner scope enforcement (#1038)', () => {
  it('runs the catalog check for a delegated token', async () => {
    mockVerifyCliToken.mockResolvedValue({ sub: 'patrick@example.test', act: 'agent', scope: ['troop:read-agents'], delegate: 'sp.example.test' })
    await requireOwner(event)
    expect(assertScope).toHaveBeenCalledWith(event, ['troop:read-agents'])
  })

  it('propagates the 403 the catalog check throws', async () => {
    mockVerifyCliToken.mockResolvedValue({ sub: 'patrick@example.test', act: 'agent', scope: ['troop:read-agents'], delegate: 'sp.example.test' })
    assertScope.mockImplementation(() => { throw Object.assign(new Error('http'), { statusCode: 403 }) })
    await expect(requireOwner(event)).rejects.toMatchObject({ statusCode: 403 })
  })

  it('leaves the first-party owner path untouched (no scope claim)', async () => {
    mockVerifyCliToken.mockResolvedValue({ sub: 'patrick@example.test', act: 'human', scope: [], delegate: null })
    await expect(requireOwner(event)).resolves.toBe('patrick@example.test')
    expect(assertScope).not.toHaveBeenCalled()
  })
})

describe('human self-restriction (#1038 step 2)', () => {
  it('binds a human token that requested a narrower scope', async () => {
    mockVerifyCliToken.mockResolvedValue({ sub: 'patrick@example.test', act: 'human', scope: ['troop:read-agents'], delegate: null })
    await expect(resolveOwnerContext(event)).resolves.toMatchObject({ scopes: ['troop:read-agents'] })
  })

  it('keeps an unrestricted human token unbounded', async () => {
    mockVerifyCliToken.mockResolvedValue({ sub: 'patrick@example.test', act: 'human', scope: [], delegate: null })
    await expect(resolveOwnerContext(event)).resolves.toMatchObject({ scopes: null })
  })
})
