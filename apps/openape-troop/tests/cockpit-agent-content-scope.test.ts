import { describe, expect, it, vi } from 'vitest'

const { mockAgent, mockSelect } = vi.hoisted(() => ({
  mockAgent: vi.fn(async () => 'agent-a'),
  mockSelect: vi.fn(),
}))

vi.mock('../server/utils/cockpit/auth', () => ({ requireCockpitAgent: mockAgent }))
vi.mock('../server/database/drizzle', () => ({ useDb: () => ({ select: mockSelect }) }))

vi.stubGlobal('defineEventHandler', (handler: unknown) => handler)
vi.stubGlobal('getRouterParam', () => 'content-1')
vi.stubGlobal('createError', (error: { statusCode: number, statusMessage: string }) =>
  Object.assign(new Error(error.statusMessage), error))

const skillHandler = (await import('../server/api/cockpit/agent/skill/[id].get')).default as unknown as (event: unknown) => Promise<unknown>
const memoryHandler = (await import('../server/api/cockpit/agent/memory/[id].get')).default as unknown as (event: unknown) => Promise<unknown>

function result(row: unknown): void {
  mockSelect.mockReturnValue({
    from: () => ({
      where: async () => row ? [row] : [],
    }),
  })
}

it('allows a skill explicitly assigned to the owner/ceo', async () => {
  result({ id: 'content-1', ownerEmail: 'owner-x', assignedTo: ['ceo'], name: 'skill', prompt: 'owner-only' })
  await expect(skillHandler({})).resolves.toMatchObject({ id: 'content-1', prompt: 'owner-only' })
})

it('hides content when the owner-bound query finds no row', async () => {
  result(undefined)
  await expect(skillHandler({})).rejects.toMatchObject({ statusCode: 404 })
  await expect(memoryHandler({})).rejects.toMatchObject({ statusCode: 404 })
})

describe('agent content retrieval scope (#1036)', () => {
  it('returns an assigned skill to its agent', async () => {
    result({ id: 'content-1', ownerEmail: 'owner@x', assignedTo: ['agent-a'], name: 'skill', prompt: 'do it' })
    await expect(skillHandler({})).resolves.toMatchObject({ id: 'content-1', prompt: 'do it' })
  })

  it('hides an owner skill from an unassigned agent', async () => {
    result({ id: 'content-1', ownerEmail: 'owner@x', assignedTo: ['agent-b'], name: 'skill', prompt: 'secret' })
    await expect(skillHandler({})).rejects.toMatchObject({ statusCode: 404 })
  })

  it('allows company memory and agent-targeted memory only', async () => {
    result({ id: 'content-1', ownerEmail: 'owner@x', scope: 'company', targetId: 'other', title: 'company', body: 'ok' })
    await expect(memoryHandler({})).resolves.toMatchObject({ body: 'ok' })

    result({ id: 'content-1', ownerEmail: 'owner@x', scope: 'agent', targetId: 'agent-a', title: 'private', body: 'ok' })
    await expect(memoryHandler({})).resolves.toMatchObject({ body: 'ok' })

    result({ id: 'content-1', ownerEmail: 'owner@x', scope: 'agent', targetId: 'agent-b', title: 'private', body: 'secret' })
    await expect(memoryHandler({})).rejects.toMatchObject({ statusCode: 404 })
  })
})
