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
const { validateAssignedTo, validateOwnerAssignedTo } = await import('../server/utils/cockpit/skill-assign')

function result(row: unknown): void {
  mockSelect.mockReturnValue({
    from: () => ({
      where: async () => Array.isArray(row) ? row : row ? [row] : [],
    }),
  })
}

describe('agent content retrieval scope (#1036)', () => {
  it('returns an assigned skill to its agent', async () => {
    result({ id: 'content-1', ownerEmail: 'owner@x', assignedTo: ['agent-a'], name: 'skill', prompt: 'do it' })
    await expect(skillHandler({})).resolves.toMatchObject({ id: 'content-1', prompt: 'do it' })
  })

  it('hides an owner skill from an unassigned agent', async () => {
    result({ id: 'content-1', ownerEmail: 'owner@x', assignedTo: ['agent-b'], name: 'skill', prompt: 'secret' })
    await expect(skillHandler({})).rejects.toMatchObject({ statusCode: 404 })
  })

  it('hides a skill owned by another owner', async () => {
    result(null)
    await expect(skillHandler({})).rejects.toMatchObject({ statusCode: 404 })
  })

  it('allows company memory and agent-targeted memory only', async () => {
    result({ id: 'content-1', ownerEmail: 'owner@x', scope: 'company', targetId: 'other', title: 'company', body: 'ok' })
    await expect(memoryHandler({})).resolves.toMatchObject({ body: 'ok' })

    result({ id: 'content-1', ownerEmail: 'owner@x', scope: 'agent', targetId: 'agent-a', title: 'private', body: 'ok' })
    await expect(memoryHandler({})).resolves.toMatchObject({ body: 'ok' })

    result({ id: 'content-1', ownerEmail: 'owner@x', scope: 'agent', targetId: 'agent-b', title: 'private', body: 'secret' })
    await expect(memoryHandler({})).rejects.toMatchObject({ statusCode: 404 })

    result(null)
    await expect(memoryHandler({})).rejects.toMatchObject({ statusCode: 404 })
  })
})

describe('skill assignment scope (#1036)', () => {
  it('deduplicates valid agent targets and keeps the ceo target', async () => {
    result([{ id: 'agent-a' }])
    await expect(validateAssignedTo('owner@x', 'org-a', ['ceo', 'agent-a', 'agent-a']))
      .resolves
      .toEqual(['ceo', 'agent-a'])
  })

  it('rejects an agent outside the organization scope', async () => {
    result([{ id: 'agent-a' }])
    await expect(validateAssignedTo('owner@x', 'org-a', ['agent-b']))
      .rejects
      .toMatchObject({ statusCode: 400 })
  })

  it('allows an owner-level skill to target an agent in another org', async () => {
    result([{ id: 'agent-b' }])
    await expect(validateOwnerAssignedTo('owner@x', ['agent-b']))
      .resolves
      .toEqual(['agent-b'])
  })

  it('rejects an owner-level skill target from another owner', async () => {
    result([])
    await expect(validateOwnerAssignedTo('owner@x', ['agent-b']))
      .rejects
      .toMatchObject({ statusCode: 400 })
  })
})
