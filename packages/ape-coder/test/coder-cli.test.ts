// story: coder-cli
//
// All 6 criteria of stories/coder-cli.md. The CLI holds no authority of its
// own: it mints an SP-scoped bearer from the shared `apes login` session via
// @openape/cli-auth and then calls the same API endpoints the web UI uses,
// which enforce the same permission model.
//
// Two layers are pinned, both without a subprocess (the level
// packages/ape-troop/test/troop-api.test.ts uses):
//
//   - CoderApi (src/coder-api.ts): the auth boundary — every request carries the
//     SP bearer minted from the shared session, and "not logged in" maps to a
//     "run `apes login`" message (criteria 1 + 5). This is infrastructure and is
//     asserted directly against a mocked bearer + mocked fetch.
//   - handlers (src/handlers.ts): the command behaviors as pure functions taking
//     an injected API client. Criteria 2, 3, 4, 6 — app/CLI parity, permission
//     parity (no CLI special rights), machine-readable reads — are pinned here
//     against a fake client. These handlers throw until the green phase.

import type { CliContext } from '../src/handlers'
import type { Project, Story } from '../src/coder-api'
import { NotLoggedInError } from '@openape/cli-auth'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const getAuthorizedBearer = vi.fn<() => Promise<string>>()

vi.mock('@openape/cli-auth', async () => {
  const actual = await vi.importActual<typeof import('@openape/cli-auth')>('@openape/cli-auth')
  return { ...actual, getAuthorizedBearer: (...args: unknown[]) => getAuthorizedBearer(...(args as [])) }
})

const { ApiError, CoderApi, resolveCoderUrl } = await import('../src/coder-api')
const { editStory, listProjects, listStories } = await import('../src/handlers')

const ORIGINAL_URL = process.env.OPENAPE_CODER_URL
const fetchMock = vi.fn<typeof fetch>()

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

function story(id: string, over: Partial<Story> = {}): Story {
  return { id, projectId: 'p1', title: 'A', storySentence: '…', acceptanceCriteria: '', repos: [], links: [], testReferences: [], status: 'draft', createdAt: 1, updatedAt: 1, ...over }
}

beforeEach(() => {
  getAuthorizedBearer.mockReset().mockResolvedValue('Bearer sp-token-for-coder')
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
  process.env.OPENAPE_CODER_URL = 'https://coder.openape.ai'
})

afterEach(() => {
  vi.unstubAllGlobals()
  if (ORIGINAL_URL === undefined) delete process.env.OPENAPE_CODER_URL
  else process.env.OPENAPE_CODER_URL = ORIGINAL_URL
})

// --- Infrastructure: the auth boundary of the API client (criteria 1 + 5). ---
describe('CoderApi auth boundary (issue #585)', () => {
  it('defaults to the prod coder URL and derives the SP audience from the host', () => {
    delete process.env.OPENAPE_CODER_URL
    expect(resolveCoderUrl()).toBe('https://coder.openape.ai')
    expect(new CoderApi('https://coder.openape.ai').aud).toBe('coder.openape.ai')
  })

  // story: coder-cli — criterion 1
  it('every call carries the SP bearer minted from the shared apes-login session — no separate login', async () => {
    fetchMock.mockResolvedValue(jsonResponse([]))
    await new CoderApi().listProjects()
    expect(getAuthorizedBearer).toHaveBeenCalledWith({ endpoint: 'https://coder.openape.ai', aud: 'coder.openape.ai' })
    const init = fetchMock.mock.calls[0]![1] as RequestInit
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer sp-token-for-coder')
  })

  // story: coder-cli — criterion 5
  it('without a valid login it points at `apes login` instead of calling the service', async () => {
    getAuthorizedBearer.mockRejectedValue(new NotLoggedInError())
    const err = await new CoderApi().listProjects().then(() => null, (e: unknown) => e)
    expect((err as Error).message).toMatch(/apes login/)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  // story: coder-cli — criterion 3 (the client surfaces the server's denial verbatim, no bypass)
  it('surfaces a server permission denial verbatim with its status', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ message: 'You do not have permission to edit this story.' }, 403))
    const err = await new CoderApi().updateStory('p1', 's1', { title: 'x' }).then(() => null, (e: unknown) => e)
    expect(err).toBeInstanceOf(ApiError)
    expect((err as InstanceType<typeof ApiError>).status).toBe(403)
    expect((err as Error).message).toBe('You do not have permission to edit this story.')
  })
})

// --- Behavior: the command handlers (criteria 2, 3, 4, 6). Throw until green. ---
describe('ape-coder command handlers (issue #585)', () => {
  function fakeContext(over: Partial<CliContext['api']> = {}): CliContext {
    return {
      api: {
        listProjects: vi.fn(async () => [] as Project[]),
        listStories: vi.fn(async () => [] as Story[]),
        getStory: vi.fn(async () => story('s1')),
        updateStory: vi.fn(async () => story('s1')),
        ...over,
      },
    }
  }

  // story: coder-cli — criterion 2
  it('`projects list` returns exactly the projects the API gives the signed-in user', async () => {
    const projects: Project[] = [
      { id: 'p1', name: 'Apollo', visionMd: '', repos: [], createdAt: 1, updatedAt: 1 },
      { id: 'p2', name: 'Gemini', visionMd: '', repos: [], createdAt: 1, updatedAt: 1 },
    ]
    const ctx = fakeContext({ listProjects: vi.fn(async () => projects) })

    const got = await listProjects(ctx)

    expect(got).toEqual(projects)
  })

  // story: coder-cli — criterion 3
  it('forwards a permission denial — what the app forbids is rejected with the server\'s message', async () => {
    const denied = new ApiError(403, 'You do not have permission to edit this story.')
    const ctx = fakeContext({ updateStory: vi.fn(async () => { throw denied }) })

    const err = await editStory(ctx, 'p1', 's1', { title: 'hijacked' }).then(() => null, (e: unknown) => e)

    expect((err as InstanceType<typeof ApiError>).status).toBe(403)
    expect((err as Error).message).toMatch(/permission/i)
  })

  // story: coder-cli — criterion 4
  it('an agent token cannot invite or change permissions via the CLI — the server rejects, the CLI forwards', async () => {
    // There is no invite/permission handler in the CLI to begin with; any admin
    // write an agent token attempts is refused server-side (act!='human') and
    // surfaced as 403 — the CLI has no special-rights path.
    const denied = new ApiError(403, 'Only humans may administer a project.')
    const ctx = fakeContext({ updateStory: vi.fn(async () => { throw denied }) })

    const err = await editStory(ctx, 'p1', 's1', { title: 'x' }).then(() => null, (e: unknown) => e)

    expect((err as InstanceType<typeof ApiError>).status).toBe(403)
  })

  // story: coder-cli — criterion 6
  it('reading returns structured data scripts/agents can build on (machine-readable)', async () => {
    const stories = [story('s1', { status: 'red' })]
    const ctx = fakeContext({ listStories: vi.fn(async () => stories) })

    const got = await listStories(ctx, 'p1')

    expect(Array.isArray(got)).toBe(true)
    expect(got[0]).toMatchObject({ id: 's1', status: 'red' })
  })
})
