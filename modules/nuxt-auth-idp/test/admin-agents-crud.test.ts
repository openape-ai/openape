// Security checklist: the admin agent CRUD surface. Creating an agent
// mints an identity plus its SSH key in one call, and PUT is the route
// that flips `isActive` — the switch the #1144/#1146 deactivation
// invariants hang off. The last describe pins where these routes and
// their `/users` siblings disagree (see PR body: findings A and B).

import { createHash } from 'node:crypto'
import { createStorage } from 'unstorage'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { adminEvent } from './helpers/admin-event'
import { generateSshEd25519Key } from './helpers/ssh-ed25519'

const ADMIN = 'admin@example.com'
const MGMT_TOKEN = 'management-secret'
const AGENT = 'bot@example.com'
const OWNER = 'owner@example.com'

const storages = new Map<string, ReturnType<typeof createStorage>>()

vi.mock('nitropack/runtime', () => ({
  useRuntimeConfig: () => ({
    openapeIdp: {
      storageKey: 'idp',
      issuer: 'https://id.openape.test',
      adminEmails: ADMIN,
      managementToken: MGMT_TOKEN,
    },
  }),
  useEvent: () => undefined,
  useStorage: (key: string) => {
    if (!storages.has(key)) storages.set(key, createStorage())
    return storages.get(key)!
  },
}))

vi.mock('h3', () => ({
  defineEventHandler: (fn: any) => fn,
  readBody: async (event: any) => event.body,
  getQuery: (event: any) => event.query ?? {},
  getRouterParam: (event: any, name: string) => event.params?.[name],
  getHeader: (event: any, name: string) => event.headers?.[name.toLowerCase()],
  createError: (opts: any) => Object.assign(new Error(opts.statusMessage), opts),
}))

let sessionUserId: string | undefined
vi.mock('../src/runtime/server/utils/session', () => ({
  getAppSession: async () => ({ data: { userId: sessionUserId } }),
}))

function asAdmin(options: Parameters<typeof adminEvent>[0] = {}) {
  sessionUserId = ADMIN
  return adminEvent(options)
}

async function userStore() {
  const { createUserStore } = await import('../src/runtime/server/utils/user-store')
  return createUserStore()
}

async function sshKeyStore() {
  const { createSshKeyStore } = await import('../src/runtime/server/utils/ssh-key-store')
  return createSshKeyStore()
}

async function seedUser(email: string, overrides: Record<string, unknown> = {}) {
  await (await userStore()).create({
    email,
    name: 'Seeded',
    isActive: true,
    createdAt: Math.floor(Date.now() / 1000),
    ...overrides,
  } as any)
}

function validAgentBody(overrides: Record<string, unknown> = {}) {
  return {
    email: AGENT,
    name: 'Bot',
    owner: OWNER,
    approver: OWNER,
    publicKey: generateSshEd25519Key('bot@openape.test').publicKeySsh,
    ...overrides,
  }
}

async function listAgents() {
  const { default: handler } = await import('../src/runtime/server/api/admin/agents/index.get')
  return handler(asAdmin())
}

async function createAgent(body: unknown) {
  const { default: handler } = await import('../src/runtime/server/api/admin/agents/index.post')
  return handler(asAdmin({ body }))
}

async function getAgent(id: string) {
  const { default: handler } = await import('../src/runtime/server/api/admin/agents/[id].get')
  return handler(asAdmin({ params: { id } }))
}

async function updateAgent(id: string, body: unknown) {
  const { default: handler } = await import('../src/runtime/server/api/admin/agents/[id].put')
  return handler(asAdmin({ params: { id }, body }))
}

async function deleteAgent(id: string, event?: any) {
  const { default: handler } = await import('../src/runtime/server/api/admin/agents/[id].delete')
  return handler(event ?? asAdmin({ params: { id } }))
}

describe('admin agents CRUD', () => {
  beforeEach(async () => {
    for (const storage of storages.values()) await storage.clear()
    sessionUserId = ADMIN
  })

  describe('auth gate', () => {
    const routes: Array<[string, string, Record<string, string>]> = [
      ['GET /agents', '../src/runtime/server/api/admin/agents/index.get', {}],
      ['POST /agents', '../src/runtime/server/api/admin/agents/index.post', {}],
      ['GET /agents/:id', '../src/runtime/server/api/admin/agents/[id].get', { id: AGENT }],
      ['PUT /agents/:id', '../src/runtime/server/api/admin/agents/[id].put', { id: AGENT }],
      ['DELETE /agents/:id', '../src/runtime/server/api/admin/agents/[id].delete', { id: AGENT }],
    ]

    it.each(routes)('%s rejects an anonymous caller with 401', async (_name, path, params) => {
      sessionUserId = undefined
      const { default: handler } = await import(path)
      await expect(handler(adminEvent({ params }))).rejects.toMatchObject({ statusCode: 401 })
    })

    it.each(routes)('%s rejects a non-admin session with 403', async (_name, path, params) => {
      sessionUserId = 'mortal@example.com'
      const { default: handler } = await import(path)
      await expect(handler(adminEvent({ params }))).rejects.toMatchObject({ statusCode: 403 })
    })

    it.each(routes)('%s rejects a wrong management token with 403', async (_name, path, params) => {
      sessionUserId = ADMIN
      const { default: handler } = await import(path)
      await expect(handler(adminEvent({ auth: 'Bearer nope', params })))
        .rejects
        .toMatchObject({ statusCode: 403 })
    })

    it('does not touch the store when the caller is rejected', async () => {
      sessionUserId = 'mortal@example.com'
      const { default: handler } = await import('../src/runtime/server/api/admin/agents/index.post')
      await expect(handler(adminEvent({ body: validAgentBody() }))).rejects.toMatchObject({ statusCode: 403 })
      expect(await (await userStore()).findByEmail(AGENT)).toBeNull()
    })
  })

  describe('GET /agents', () => {
    it('lists only identities that have an owner', async () => {
      await seedUser(AGENT, { owner: OWNER })
      await seedUser('human@example.com')

      const result = await listAgents()
      expect(result.map((u: any) => u.email)).toEqual([AGENT])
    })

    it('returns an empty list when only humans exist', async () => {
      await seedUser('human@example.com')
      expect(await listAgents()).toEqual([])
    })
  })

  describe('POST /agents', () => {
    it('creates an active agent identity and its SSH key in one call', async () => {
      const body = validAgentBody()
      const created = await createAgent(body)

      expect(created).toMatchObject({
        email: AGENT,
        name: 'Bot',
        owner: OWNER,
        approver: OWNER,
        type: 'agent',
        isActive: true,
      })

      const stored = await (await userStore()).findByEmail(AGENT)
      expect(stored).toEqual(created)

      const keys = await (await sshKeyStore()).findByUser(AGENT)
      expect(keys).toHaveLength(1)
      expect(keys[0]!.publicKey).toBe(body.publicKey)
      expect(keys[0]!.name).toBe('Bot')
    })

    it('derives the keyId from the SHA-256 of the raw key blob', async () => {
      const body = validAgentBody()
      await createAgent(body)

      const blob = (body.publicKey as string).split(/\s+/)[1]!
      const expected = createHash('sha256').update(Buffer.from(blob, 'base64')).digest('hex')
      expect((await (await sshKeyStore()).findByUser(AGENT))[0]!.keyId).toBe(expected)
    })

    it.each(['email', 'name', 'owner', 'approver', 'publicKey'])(
      'rejects a body without %s and stores nothing',
      async (field) => {
        await expect(createAgent(validAgentBody({ [field]: undefined })))
          .rejects
          .toMatchObject({ statusCode: 400 })
        expect(await (await userStore()).findByEmail(AGENT)).toBeNull()
      },
    )

    it('rejects a public key that is not ssh-ed25519', async () => {
      await expect(createAgent(validAgentBody({ publicKey: 'ssh-rsa AAAAB3NzaC1yc2E= bot' })))
        .rejects
        .toMatchObject({ statusCode: 400 })
      expect(await (await userStore()).findByEmail(AGENT)).toBeNull()
    })

    it('rejects a duplicate email with 409 and keeps the original identity', async () => {
      await seedUser(AGENT, { name: 'Original', owner: OWNER })
      await expect(createAgent(validAgentBody({ name: 'Impostor' })))
        .rejects
        .toMatchObject({ statusCode: 409 })

      expect((await (await userStore()).findByEmail(AGENT))!.name).toBe('Original')
      expect(await (await sshKeyStore()).findByUser(AGENT)).toEqual([])
    })
  })

  describe('GET /agents/:id', () => {
    it('returns the stored identity', async () => {
      await seedUser(AGENT, { owner: OWNER })
      expect(await getAgent(AGENT)).toMatchObject({ email: AGENT, owner: OWNER })
    })

    it('decodes a URL-encoded id', async () => {
      await seedUser(AGENT, { owner: OWNER })
      expect(await getAgent(encodeURIComponent(AGENT))).toMatchObject({ email: AGENT })
    })

    it('returns 404 for an unknown id', async () => {
      await expect(getAgent('ghost@example.com')).rejects.toMatchObject({ statusCode: 404 })
    })

    it('rejects a missing id with 400', async () => {
      const { default: handler } = await import('../src/runtime/server/api/admin/agents/[id].get')
      await expect(handler(asAdmin({ params: {} }))).rejects.toMatchObject({ statusCode: 400 })
    })
  })

  describe('PUT /agents/:id', () => {
    it('applies only the fields present in the body', async () => {
      await seedUser(AGENT, { name: 'Bot', owner: OWNER, approver: OWNER })
      const updated = await updateAgent(AGENT, { name: 'Renamed Bot' })

      expect(updated).toMatchObject({ name: 'Renamed Bot', owner: OWNER, approver: OWNER, isActive: true })
      expect(await (await userStore()).findByEmail(AGENT)).toEqual(updated)
    })

    it('deactivates an agent — the switch #1144/#1146 hang off', async () => {
      await seedUser(AGENT, { owner: OWNER })
      const updated = await updateAgent(AGENT, { isActive: false })

      expect(updated.isActive).toBe(false)
      expect((await (await userStore()).findByEmail(AGENT))!.isActive).toBe(false)
    })

    it('reactivates a deactivated agent', async () => {
      await seedUser(AGENT, { owner: OWNER, isActive: false })
      expect((await updateAgent(AGENT, { isActive: true })).isActive).toBe(true)
    })

    it('reassigns owner and approver', async () => {
      await seedUser(AGENT, { owner: OWNER, approver: OWNER })
      const updated = await updateAgent(AGENT, { owner: 'new@example.com', approver: 'boss@example.com' })
      expect(updated).toMatchObject({ owner: 'new@example.com', approver: 'boss@example.com' })
    })

    it('leaves the record untouched for an empty body', async () => {
      await seedUser(AGENT, { owner: OWNER })
      const before = await (await userStore()).findByEmail(AGENT)
      expect(await updateAgent(AGENT, {})).toEqual(before)
    })

    it('returns 404 for an unknown id without creating anything', async () => {
      await expect(updateAgent('ghost@example.com', { name: 'x' })).rejects.toMatchObject({ statusCode: 404 })
      expect(await (await userStore()).findByEmail('ghost@example.com')).toBeNull()
    })

    it('rejects a missing id with 400', async () => {
      const { default: handler } = await import('../src/runtime/server/api/admin/agents/[id].put')
      await expect(handler(asAdmin({ params: {}, body: {} }))).rejects.toMatchObject({ statusCode: 400 })
    })
  })

  describe('DELETE /agents/:id', () => {
    it('removes the identity', async () => {
      await seedUser(AGENT, { owner: OWNER })
      expect(await deleteAgent(AGENT)).toEqual({ ok: true })
      expect(await (await userStore()).findByEmail(AGENT)).toBeNull()
    })

    it('decodes a URL-encoded id', async () => {
      await seedUser(AGENT, { owner: OWNER })
      await deleteAgent(encodeURIComponent(AGENT))
      expect(await (await userStore()).findByEmail(AGENT)).toBeNull()
    })

    it('returns 404 for an unknown id', async () => {
      await expect(deleteAgent('ghost@example.com')).rejects.toMatchObject({ statusCode: 404 })
    })

    it('rejects a missing id with 400', async () => {
      const { default: handler } = await import('../src/runtime/server/api/admin/agents/[id].delete')
      await expect(handler(asAdmin({ params: {} }))).rejects.toMatchObject({ statusCode: 400 })
    })
  })

  // The /agents/:id routes address the same `users:` rows as /users/:email
  // but carry none of that routes guards. These tests pin the current
  // behaviour so the difference is visible rather than assumed.
  describe('overlap with the /users routes (findings A and B)', () => {
    // FINDING A: /agents/:id never checks `type === 'agent'` or that an
    // owner is set, so a human identity can be read, rewritten and deleted
    // through the agent surface — including the callers own account, which
    // DELETE /users/:email explicitly refuses.
    it('deletes a human identity that GET /agents never lists', async () => {
      await seedUser('human@example.com')
      expect(await listAgents()).toEqual([])

      await deleteAgent('human@example.com')
      expect(await (await userStore()).findByEmail('human@example.com')).toBeNull()
    })

    it('lets an admin delete their own account, bypassing the /users self-delete guard', async () => {
      await seedUser(ADMIN)

      const { default: usersDelete } = await import('../src/runtime/server/api/admin/users/[email].delete')
      await expect(usersDelete(asAdmin({ params: { email: ADMIN } })))
        .rejects
        .toMatchObject({ statusCode: 400 })

      await deleteAgent(ADMIN)
      expect(await (await userStore()).findByEmail(ADMIN)).toBeNull()
    })

    // FINDING B: DELETE /users/:email also clears the users SSH keys;
    // DELETE /agents/:id does not, so the credentials outlive the identity.
    it('leaves the SSH keys behind, unlike DELETE /users/:email', async () => {
      const created = await createAgent(validAgentBody())
      const keyId = (await (await sshKeyStore()).findByUser(AGENT))[0]!.keyId

      await deleteAgent(created.email)

      expect(await (await userStore()).findByEmail(AGENT)).toBeNull()
      expect(await (await sshKeyStore()).findById(keyId)).not.toBeNull()
      expect(await (await sshKeyStore()).findByUser(AGENT)).toHaveLength(1)
    })
  })
})
