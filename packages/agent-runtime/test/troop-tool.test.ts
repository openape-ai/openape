import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@openape/cli-auth', () => ({
  getAuthorizedBearer: vi.fn(async () => 'Bearer tok-123'),
}))

const { troopTools } = await import('../src/agent-tools/troop')
const { getAuthorizedBearer } = await import('@openape/cli-auth')

const tool = troopTools.find(t => t.name === 'troop.company.read')!
const upsert = troopTools.find(t => t.name === 'troop.objective.upsert')!
const ORG = '38f8e8e9-eec5-440c-b716-6c0f8224270c'

afterEach(() => vi.restoreAllMocks())

describe('troop.company.read', () => {
  it('fetches the resource path with the agent bearer and returns the JSON', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify([{ id: 'o1' }]), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const out = await tool.execute({ resource: 'objectives', org_id: ORG })

    expect(getAuthorizedBearer).toHaveBeenCalledWith({ endpoint: 'https://troop.openape.ai', aud: 'troop.openape.ai' })
    const url = fetchMock.mock.calls[0]![0] as string
    expect(url).toBe(`https://troop.openape.ai/api/orgs/${ORG}/objectives`)
    expect((fetchMock.mock.calls[0]![1] as RequestInit).headers).toMatchObject({ authorization: 'Bearer tok-123' })
    expect(out).toBe(JSON.stringify([{ id: 'o1' }]))
  })

  it('maps overview to the org root path', async () => {
    const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    await tool.execute({ resource: 'overview', org_id: ORG })
    expect(fetchMock.mock.calls[0]![0]).toBe(`https://troop.openape.ai/api/orgs/${ORG}`)
  })

  it('throws on an unknown resource', async () => {
    await expect(tool.execute({ resource: 'secrets', org_id: ORG })).rejects.toThrow(/unknown resource/)
  })

  it('throws on a non-ok response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 403 })))
    await expect(tool.execute({ resource: 'objectives', org_id: ORG })).rejects.toThrow(/403/)
  })
})

describe('troop.objective.upsert', () => {
  it('POSTs a new objective when no objective_id', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ id: 'obj1' }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    await upsert.execute({ org_id: ORG, title: 'Ship X', status: 'in_progress' })
    const [url, init] = fetchMock.mock.calls[0]! as [string, RequestInit]
    expect(url).toBe(`https://troop.openape.ai/api/orgs/${ORG}/objectives`)
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body as string)).toMatchObject({ title: 'Ship X', status: 'in_progress' })
  })

  it('PATCHes an existing objective when objective_id is given', async () => {
    const fetchMock = vi.fn(async () => new Response('{"ok":true}', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    await upsert.execute({ org_id: ORG, objective_id: 'obj1', status: 'done' })
    const [url, init] = fetchMock.mock.calls[0]! as [string, RequestInit]
    expect(url).toBe(`https://troop.openape.ai/api/orgs/${ORG}/objectives/obj1`)
    expect(init.method).toBe('PATCH')
  })

  it('requires a title to create', async () => {
    await expect(upsert.execute({ org_id: ORG })).rejects.toThrow(/title is required/)
  })

  it('rejects a bad status', async () => {
    await expect(upsert.execute({ org_id: ORG, title: 't', status: 'bogus' })).rejects.toThrow(/bad status/)
  })
})
