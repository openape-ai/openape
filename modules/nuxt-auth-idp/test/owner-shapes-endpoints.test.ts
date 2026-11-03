// @vitest-environment node
// Owner-published shapes (issue 1551): only the signed-in human owner
// publishes, lists and removes their own shapes; the registry always wins.
import type { OpenApeGrant } from '@openape/core'
import type { H3Event } from 'h3'
import { createServer } from 'node:http'
import type { ServerShape } from '@openape/grants'
import { createInMemoryShapeStore, InMemoryGrantStore } from '@openape/grants'
import { createApp, createRouter, getHeader, toNodeListener } from 'h3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const owner = 'owner@example.test'
const agent = 'agent@example.test'
const otherOwner = 'other@example.test'
const issuer = 'https://id.example.test'
const registryGit: ServerShape = { cli_id: 'git', executable: 'git', description: '', operations: [], source: 'builtin', digest: 'SHA-256:git', createdAt: 0, updatedAt: 0 }

let shapeStore = createInMemoryShapeStore([registryGit])
let grantStore = new InMemoryGrantStore()
let server: ReturnType<typeof createServer>
let base: string

vi.mock('../src/runtime/server/utils/agent-auth', () => ({
  tryBearerAuth: async (event: H3Event) => {
    const subject = getHeader(event, 'authorization')?.replace('Bearer ', '')
    if (subject === 'delegated') return { sub: owner, act: 'human', delegation_grant: 'g-delegation' }
    return subject ? { sub: subject, act: subject === agent ? 'agent' : 'human' } : null
  },
}))
// A browser session of the owner, signalled by a test header instead of a cookie.
vi.mock('../src/runtime/server/utils/session', () => ({ getAppSession: async (event: H3Event) => ({ data: getHeader(event, 'x-test-session') ? { userId: owner } : {} }) }))
vi.mock('nitropack/runtime', () => ({ useRuntimeConfig: () => ({}), useEvent: () => undefined, useStorage: () => ({}) }))
vi.mock('../src/runtime/server/utils/grant-stores', () => ({ useGrantStores: () => ({ grantStore }) }))
vi.mock('../src/runtime/server/utils/shape-store', () => ({ useShapeStore: () => shapeStore }))
vi.mock('../src/runtime/server/utils/stores', () => ({
  getIdpIssuer: () => issuer,
  useIdpStores: () => ({
    userStore: {
      findByEmail: async (email: string) => email === agent ? { email, type: 'agent', owner, isActive: true } : { email, type: 'human', isActive: true },
      findByOwner: async (email: string) => email === owner ? [{ email: agent, type: 'agent', owner, isActive: true }] : [],
    },
  }),
}))

const index = (await import('../src/runtime/server/api/shapes/index.get')).default
const put = (await import('../src/runtime/server/api/shapes/[cliId].put')).default
const remove = (await import('../src/runtime/server/api/shapes/[cliId].delete')).default

function jevToml(operation = 'ask') {
  return `schema = "openape-shapes/v1"

[cli]
id = "jev"
executable = "jev"
audience = "shapes"
version = "1"

[[operation]]
id = "${operation}"
command = ["${operation}"]
display = "Ask Jev"
action = "read"
risk = "low"
resource_chain = ["model:name=jev"]
`
}

async function request(method: string, path: string, subject: string | null, body?: unknown) {
  const response = await fetch(`${base}${path}`, { method, headers: { 'Content-Type': 'application/json', ...(subject ? { Authorization: `Bearer ${subject}` } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
  return { status: response.status, json: await response.json() as Record<string, any> }
}

function approvedGrant(digest: string): OpenApeGrant {
  return {
    id: `g-${digest}`,
    status: 'approved',
    type: 'command',
    created_at: 1,
    decided_at: 2,
    request: {
      requester: agent,
      target_host: 'macmini',
      audience: 'shapes',
      grant_type: 'always',
      permissions: ['p'],
      authorization_details: [{ type: 'openape_cli', cli_id: 'jev', operation_id: 'ask', resource_chain: [], action: 'read', permission: 'p', display: 'Ask Jev', risk: 'low' }],
      execution_context: { adapter_id: 'jev', adapter_version: 'server', adapter_digest: digest, adapter_owner: owner, resolved_executable: 'jev', program_sha256: 'a'.repeat(64) },
    },
  }
}

beforeEach(async () => {
  shapeStore = createInMemoryShapeStore([registryGit])
  grantStore = new InMemoryGrantStore()
  const router = createRouter().get('/shapes', index).put('/shapes/:cliId', put).delete('/shapes/:cliId', remove)
  server = createServer(toNodeListener(createApp().use(router)))
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('Fixture did not start')
  base = `http://127.0.0.1:${address.port}`
})
afterEach(async () => { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())) })

describe('owner shape endpoints', () => {
  it('accepts session writes only from the IdP origin and never a delegated token', async () => {
    const session = (origin: string) => fetch(`${base}/shapes/jev`, { method: 'PUT', headers: { 'Content-Type': 'application/json', 'x-test-session': '1', 'Origin': origin }, body: JSON.stringify({ toml: jevToml() }) })
    expect((await session('https://evil.example')).status).toBe(403)
    expect((await session(issuer)).status).toBe(200)
    expect((await request('PUT', '/shapes/jev', 'delegated', { toml: jevToml() })).status).toBe(403)
    expect((await request('DELETE', '/shapes/jev', 'delegated')).status).toBe(403)
  })

  it('previews without saving, publishes, and lists only the owner\'s shapes', async () => {
    const preview = await request('PUT', '/shapes/jev?dry_run=1', owner, { toml: jevToml() })
    expect(preview.status).toBe(200)
    expect(preview.json).toMatchObject({ saved: false, replaced_digest: null, shape: { cli_id: 'jev', executable: 'jev', digest: expect.stringMatching(/^SHA-256:/) } })
    expect(await shapeStore.listOwnerShapes!(owner)).toEqual([])

    const published = await request('PUT', '/shapes/jev', owner, { toml: jevToml() })
    expect(published.json.saved).toBe(true)
    expect((await request('GET', '/shapes?mine=1', owner)).json).toMatchObject([{ cli_id: 'jev', toml: jevToml(), bound_grants: [] }])
    expect((await request('GET', '/shapes?mine=1', otherOwner)).json).toEqual([])
    // The public list stays the registry.
    expect((await request('GET', '/shapes', null)).json.map((shape: ServerShape) => shape.cli_id)).toEqual(['git'])
  })

  it('names the continuing grants a new digest or a removal stops reusing', async () => {
    const first = await request('PUT', '/shapes/jev', owner, { toml: jevToml() })
    const digest = first.json.shape.digest as string
    await grantStore.save(approvedGrant(digest))
    expect((await request('GET', '/shapes?mine=1', owner)).json[0].bound_grants).toMatchObject([{ id: `g-${digest}`, requester: agent, operation_id: 'ask', digest_current: true }])
    // Same content again: same digest, nothing loses reuse.
    expect((await request('PUT', '/shapes/jev?dry_run=1', owner, { toml: jevToml() })).json.grants_losing_reuse).toEqual([])
    const changed = await request('PUT', '/shapes/jev?dry_run=1', owner, { toml: jevToml('query') })
    expect(changed.json).toMatchObject({ replaced_digest: digest, grants_losing_reuse: [{ id: `g-${digest}` }] })
    const removed = await request('DELETE', '/shapes/jev', owner)
    expect(removed.json).toMatchObject({ removed: true, grants_losing_reuse: [{ id: `g-${digest}` }] })
    expect((await request('DELETE', '/shapes/jev', owner)).status).toBe(404)
  })

  it('refuses agents, mismatched ids and adapters the matcher cannot use, but accepts an IdP-wide name', async () => {
    expect((await request('PUT', '/shapes/jev', agent, { toml: jevToml() })).status).toBe(403)
    expect((await request('GET', '/shapes?mine=1', agent)).status).toBe(403)
    const git = jevToml().replace('id = "jev"\nexecutable = "jev"', 'id = "git"\nexecutable = "git"')
    // A personal shape may override an IdP-wide shape for its owner (issue 1553).
    expect((await request('PUT', '/shapes/git?dry_run=1', owner, { toml: git })).status).toBe(200)
    expect((await request('PUT', '/shapes/other', owner, { toml: jevToml() })).status).toBe(400)
    const badChain = await request('PUT', '/shapes/jev', owner, { toml: jevToml().replace('model:name=jev', 'model:jev') })
    expect(badChain.status).toBe(400)
    expect(JSON.stringify(badChain.json)).toContain('key=value')
    const tested = jevToml().replace('version = "1"', `version = "1"\ntested_digests = ["SHA-256:${'a'.repeat(64)}"]`)
    expect((await request('PUT', '/shapes/jev', owner, { toml: tested })).status).toBe(400)
    const generic = jevToml('_generic.exec')
    expect((await request('PUT', '/shapes/jev', owner, { toml: generic })).status).toBe(400)
    const reserved = jevToml().replace('id = "jev"\nexecutable = "jev"', 'id = "pod-runtime"\nexecutable = "pod-runtime"')
    expect((await request('PUT', '/shapes/pod-runtime', owner, { toml: reserved })).status).toBe(409)
    expect((await request('PUT', '/shapes/jev', owner, { toml: 'not toml [' })).status).toBe(400)
    // A duplicate id would let the resolver read a later `deny` from an earlier operation.
    const duplicate = `${jevToml()}\n[[operation]]\nid = "ask"\ncommand = ["delete"]\ndisplay = "Delete"\naction = "delete"\nrisk = "high"\nresource_chain = []\ndecision = "deny"\n`
    const duplicated = await request('PUT', '/shapes/jev', owner, { toml: duplicate })
    expect(duplicated.status).toBe(400)
    expect(JSON.stringify(duplicated.json)).toContain('declared twice')
    for (const chain of ['model:name={missing}', 'model:name={name|unsupported}']) {
      const unbound = await request('PUT', '/shapes/jev', owner, { toml: jevToml().replace('model:name=jev', chain) })
      expect(unbound.status, chain).toBe(400)
    }
    // A positional binding renders, including the owner transform.
    const bound = jevToml().replace('command = ["ask"]', 'command = ["ask"]\npositionals = ["repo"]').replace('model:name=jev', 'repo:owner={repo|owner}')
    expect((await request('PUT', '/shapes/jev?dry_run=1', owner, { toml: bound })).status).toBe(200)
    expect(await shapeStore.listOwnerShapes!(owner)).toEqual([])
  })

  it('refuses a second own shape for the same program', async () => {
    expect((await request('PUT', '/shapes/jev', owner, { toml: jevToml() })).status).toBe(200)
    const renamed = jevToml().replace('id = "jev"', 'id = "jev-new"')
    const clash = await request('PUT', '/shapes/jev-new', owner, { toml: renamed })
    expect(clash.status).toBe(409)
    expect(JSON.stringify(clash.json)).toContain('already describes jev')
  })
})
