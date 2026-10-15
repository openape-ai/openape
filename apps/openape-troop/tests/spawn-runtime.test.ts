import { afterEach, describe, expect, it, vi } from 'vitest'

const { dispatch } = vi.hoisted(() => ({ dispatch: vi.fn() }))
vi.mock('../server/utils/auth', () => ({ requireOwnerWithScope: async () => ({ owner: 'owner@example.test' }) }))
vi.mock('../server/utils/spawn-dispatch', () => ({ dispatchSpawnIntent: dispatch }))

vi.stubGlobal('defineEventHandler', (handler: unknown) => handler)
vi.stubGlobal('createError', (error: { statusCode: number, statusMessage: string }) => Object.assign(new Error(error.statusMessage), error))
const readBody = vi.fn()
vi.stubGlobal('readBody', readBody)
const handler = (await import('../server/api/agents/spawn-intent.post')).default as unknown as (event: unknown) => Promise<unknown>

afterEach(() => vi.clearAllMocks())

describe('spawn runtime boundary', () => {
  it('rejects retired runtimes before dispatching a spawn intent', async () => {
    readBody.mockResolvedValue({ name: 'legacy', runtime_type: 'openclaw' })
    await expect(handler({})).rejects.toMatchObject({ statusCode: 400 })
    expect(dispatch).not.toHaveBeenCalled()
  })

  it.each([undefined, 'bridge'])('preserves bridge provisioning with runtime %s', async (runtimeType) => {
    readBody.mockResolvedValue({ name: 'worker', runtime_type: runtimeType })
    dispatch.mockResolvedValue({ intentId: 'intent-1', hostId: 'host-1', hostname: 'test-host' })
    await handler({})
    expect(dispatch).toHaveBeenCalledWith('owner@example.test', expect.objectContaining({ name: 'worker', runtimeType }))
  })
})
