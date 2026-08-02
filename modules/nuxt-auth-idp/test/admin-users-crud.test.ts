// Security checklist: the admin user CRUD surface — every route sits
// behind the real `requireAdmin` tier, writes are checked against what
// actually lands in the store, and the destructive ones (delete user,
// delete SSH key, add SSH key) are pinned on their guards: self-deletion,
// duplicate keys, key-format validation and credential-secret hygiene.

import { createStorage } from 'unstorage'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { adminEvent } from './helpers/admin-event'
import { generateSshEd25519Key } from './helpers/ssh-ed25519'

const ADMIN = 'admin@example.com'
const MGMT_TOKEN = 'management-secret'
const USER = 'human@example.com'

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

/** Authenticated as the allowlisted admin unless a test says otherwise. */
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
  const store = await userStore()
  await store.create({
    email,
    name: 'Seeded',
    isActive: true,
    createdAt: Math.floor(Date.now() / 1000),
    ...overrides,
  } as any)
}

async function listUsers(event = asAdmin()) {
  const { default: handler } = await import('../src/runtime/server/api/admin/users/index.get')
  return handler(event)
}

async function createUser(body: unknown, event = asAdmin({ body })) {
  const { default: handler } = await import('../src/runtime/server/api/admin/users/index.post')
  return handler(event)
}

async function deleteUser(email: string, event?: any) {
  const { default: handler } = await import('../src/runtime/server/api/admin/users/[email].delete')
  return handler(event ?? asAdmin({ params: { email } }))
}

async function getCredentials(email: string) {
  const { default: handler } = await import('../src/runtime/server/api/admin/users/[email]/credentials.get')
  return handler(asAdmin({ params: { email } }))
}

async function getSshKeys(email: string) {
  const { default: handler } = await import('../src/runtime/server/api/admin/users/[email]/ssh-keys.get')
  return handler(asAdmin({ params: { email } }))
}

async function addSshKey(email: string, body: unknown) {
  const { default: handler } = await import('../src/runtime/server/api/admin/users/[email]/ssh-keys.post')
  return handler(asAdmin({ params: { email }, body }))
}

async function deleteSshKey(keyId: string) {
  const { default: handler } = await import('../src/runtime/server/api/admin/users/[email]/ssh-keys/[keyId].delete')
  return handler(asAdmin({ params: { keyId } }))
}

describe('admin users CRUD', () => {
  beforeEach(async () => {
    for (const storage of storages.values()) await storage.clear()
    sessionUserId = ADMIN
  })

  describe('auth gate', () => {
    // Every admin route funnels through the real `requireAdmin`, so the
    // tier is asserted once per route rather than re-tested per verb.
    const routes: Array<[string, string, Record<string, string>]> = [
      ['GET /users', '../src/runtime/server/api/admin/users/index.get', {}],
      ['POST /users', '../src/runtime/server/api/admin/users/index.post', {}],
      ['DELETE /users/:email', '../src/runtime/server/api/admin/users/[email].delete', { email: USER }],
      ['GET /users/:email/credentials', '../src/runtime/server/api/admin/users/[email]/credentials.get', { email: USER }],
      ['GET /users/:email/ssh-keys', '../src/runtime/server/api/admin/users/[email]/ssh-keys.get', { email: USER }],
      ['POST /users/:email/ssh-keys', '../src/runtime/server/api/admin/users/[email]/ssh-keys.post', { email: USER }],
      ['DELETE /users/:email/ssh-keys/:keyId', '../src/runtime/server/api/admin/users/[email]/ssh-keys/[keyId].delete', { keyId: 'k1' }],
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
      sessionUserId = ADMIN // a valid admin session must not rescue a bad token
      const { default: handler } = await import(path)
      await expect(handler(adminEvent({ auth: 'Bearer nope', params })))
        .rejects
        .toMatchObject({ statusCode: 403 })
    })

    it('accepts the management token without any session', async () => {
      sessionUserId = undefined
      await seedUser(USER)
      const { default: handler } = await import('../src/runtime/server/api/admin/users/index.get')
      const result = await handler(adminEvent({ auth: `Bearer ${MGMT_TOKEN}` }))
      expect(result.data.map((u: any) => u.email)).toEqual([USER])
    })
  })

  describe('GET /users', () => {
    it('returns the stored users with pagination metadata', async () => {
      await seedUser('a@example.com')
      await seedUser('b@example.com')
      const result = await listUsers()
      expect(result.data.map((u: any) => u.email).sort()).toEqual(['a@example.com', 'b@example.com'])
      expect(result.pagination.has_more).toBe(false)
      expect(result.pagination.cursor).toBeTruthy()
    })

    it('returns an empty page when no users exist', async () => {
      const result = await listUsers()
      expect(result.data).toEqual([])
      expect(result.pagination.cursor).toBeNull()
    })
  })

  describe('POST /users', () => {
    it('persists an active user and echoes back the identity', async () => {
      const result = await createUser({ email: USER, name: 'Human' })
      expect(result).toEqual({ ok: true, email: USER, name: 'Human' })

      const stored = await (await userStore()).findByEmail(USER)
      expect(stored).toMatchObject({ email: USER, name: 'Human', isActive: true })
      expect(stored!.createdAt).toBeGreaterThan(0)
    })

    it.each([
      ['email', { name: 'Human' }],
      ['name', { email: USER }],
      ['both', {}],
    ])('rejects a body missing %s with 400', async (_label, body) => {
      await expect(createUser(body)).rejects.toMatchObject({ statusCode: 400 })
    })

    it('rejects an email longer than 255 characters', async () => {
      const email = `${'x'.repeat(250)}@example.com`
      await expect(createUser({ email, name: 'Human' })).rejects.toMatchObject({ statusCode: 400 })
      expect(await (await userStore()).findByEmail(email)).toBeNull()
    })

    it('rejects a name longer than 255 characters', async () => {
      await expect(createUser({ email: USER, name: 'x'.repeat(256) }))
        .rejects
        .toMatchObject({ statusCode: 400 })
      expect(await (await userStore()).findByEmail(USER)).toBeNull()
    })

    it('rejects a duplicate email with 409 and leaves the existing row intact', async () => {
      await seedUser(USER, { name: 'Original' })
      await expect(createUser({ email: USER, name: 'Impostor' }))
        .rejects
        .toMatchObject({ statusCode: 409 })
      expect((await (await userStore()).findByEmail(USER))!.name).toBe('Original')
    })
  })

  describe('DELETE /users/:email', () => {
    it('removes the user and every SSH key they own', async () => {
      await seedUser(USER)
      const key = generateSshEd25519Key()
      await (await sshKeyStore()).save({
        keyId: 'key-1',
        userEmail: USER,
        publicKey: key.publicKeySsh,
        name: 'laptop',
        createdAt: Date.now(),
      })

      expect(await deleteUser(USER)).toEqual({ ok: true })
      expect(await (await userStore()).findByEmail(USER)).toBeNull()
      expect(await (await sshKeyStore()).findByUser(USER)).toEqual([])
      expect(await (await sshKeyStore()).findById('key-1')).toBeNull()
    })

    it('decodes a URL-encoded email before looking it up', async () => {
      await seedUser(USER)
      await deleteUser(encodeURIComponent(USER))
      expect(await (await userStore()).findByEmail(USER)).toBeNull()
    })

    it('refuses to delete the caller their own account', async () => {
      await seedUser(ADMIN)
      await expect(deleteUser(ADMIN)).rejects.toMatchObject({
        statusCode: 400,
        statusMessage: 'Cannot delete your own account',
      })
      expect(await (await userStore()).findByEmail(ADMIN)).not.toBeNull()
    })

    it('returns 404 for an unknown user', async () => {
      await expect(deleteUser('ghost@example.com')).rejects.toMatchObject({ statusCode: 404 })
    })

    it('rejects a missing email parameter with 400', async () => {
      await expect(deleteUser('', asAdmin({ params: {} }))).rejects.toMatchObject({ statusCode: 400 })
    })
  })

  describe('GET /users/:email/credentials', () => {
    async function seedCredential(email: string, credentialId: string) {
      const { createCredentialStore } = await import('../src/runtime/server/utils/credential-store')
      await createCredentialStore().save({
        credentialId,
        userEmail: email,
        publicKey: 'super-secret-public-key-material',
        counter: 7,
        deviceType: 'singleDevice',
        backedUp: false,
        transports: ['internal'],
        createdAt: 1700000000,
        name: 'MacBook',
      } as any)
    }

    it('lists a users passkeys without leaking key material or counters', async () => {
      await seedCredential(USER, 'cred-1')
      const result = await getCredentials(USER)
      expect(result).toEqual([{
        credentialId: 'cred-1',
        name: 'MacBook',
        deviceType: 'singleDevice',
        backedUp: false,
        createdAt: 1700000000,
        transports: ['internal'],
      }])
      expect(JSON.stringify(result)).not.toContain('super-secret-public-key-material')
    })

    it('returns an empty list for a user without credentials', async () => {
      await seedUser(USER)
      expect(await getCredentials(USER)).toEqual([])
    })

    it('rejects a missing email parameter with 400', async () => {
      const { default: handler } = await import('../src/runtime/server/api/admin/users/[email]/credentials.get')
      await expect(handler(asAdmin({ params: {} }))).rejects.toMatchObject({ statusCode: 400 })
    })

    // FINDING: this route does NOT decodeURIComponent the email, unlike its
    // ssh-keys siblings. A caller that percent-encodes the address (the
    // normal way to build the path) silently gets an empty list instead of
    // the users passkeys. Pinned here rather than fixed — see PR body.
    it('does not decode a URL-encoded email, unlike the ssh-keys routes', async () => {
      await seedCredential(USER, 'cred-1')
      expect(await getCredentials(encodeURIComponent(USER))).toEqual([])
      expect(await getSshKeys(encodeURIComponent(USER))).toEqual([])
    })
  })

  describe('GET /users/:email/ssh-keys', () => {
    it('returns only the keys belonging to that user', async () => {
      const store = await sshKeyStore()
      await store.save({ keyId: 'k1', userEmail: USER, publicKey: 'ssh-ed25519 AAA a', name: 'a', createdAt: 1 })
      await store.save({ keyId: 'k2', userEmail: 'other@example.com', publicKey: 'ssh-ed25519 BBB b', name: 'b', createdAt: 2 })

      const result = await getSshKeys(USER)
      expect(result.map((k: any) => k.keyId)).toEqual(['k1'])
    })

    it('returns an empty list for a user without keys', async () => {
      expect(await getSshKeys(USER)).toEqual([])
    })

    it('rejects an empty email parameter with 400', async () => {
      const { default: handler } = await import('../src/runtime/server/api/admin/users/[email]/ssh-keys.get')
      await expect(handler(asAdmin({ params: { email: '' } }))).rejects.toMatchObject({ statusCode: 400 })
    })
  })

  describe('POST /users/:email/ssh-keys', () => {
    it('stores the key under its SHA-256 fingerprint and indexes it for the user', async () => {
      await seedUser(USER)
      const key = generateSshEd25519Key('laptop@openape.test')
      const saved = await addSshKey(USER, { publicKey: key.publicKeySsh })

      expect(saved.userEmail).toBe(USER)
      expect(saved.publicKey).toBe(key.publicKeySsh)
      expect(saved.keyId).toMatch(/^[0-9a-f]{64}$/)

      const stored = await (await sshKeyStore()).findById(saved.keyId)
      expect(stored).toEqual(saved)
      expect((await (await sshKeyStore()).findByUser(USER)).map(k => k.keyId)).toEqual([saved.keyId])
    })

    it('falls back to the key comment as the display name', async () => {
      const key = generateSshEd25519Key('patrick@macbook')
      const saved = await addSshKey(USER, { publicKey: key.publicKeySsh })
      expect(saved.name).toBe('patrick@macbook')
    })

    it('names a comment-less key "SSH Key"', async () => {
      const key = generateSshEd25519Key('')
      const saved = await addSshKey(USER, { publicKey: key.publicKeySsh })
      expect(saved.name).toBe('SSH Key')
    })

    it('prefers an explicit name over the comment', async () => {
      const key = generateSshEd25519Key('patrick@macbook')
      const saved = await addSshKey(USER, { publicKey: key.publicKeySsh, name: 'Work laptop' })
      expect(saved.name).toBe('Work laptop')
    })

    it('creates the user shell when the account does not exist yet', async () => {
      const key = generateSshEd25519Key('bootstrap@openape.test')
      await addSshKey('fresh@example.com', { publicKey: key.publicKeySsh })

      const created = await (await userStore()).findByEmail('fresh@example.com')
      expect(created).toMatchObject({ email: 'fresh@example.com', isActive: true })
    })

    it('leaves an existing user record untouched', async () => {
      await seedUser(USER, { name: 'Original', isActive: false })
      const key = generateSshEd25519Key('another@openape.test')
      await addSshKey(USER, { publicKey: key.publicKeySsh })

      const stored = await (await userStore()).findByEmail(USER)
      expect(stored).toMatchObject({ name: 'Original', isActive: false })
    })

    it('rejects a missing publicKey with 400', async () => {
      await expect(addSshKey(USER, { name: 'x' })).rejects.toMatchObject({ statusCode: 400 })
    })

    it('rejects a non-string publicKey with 400', async () => {
      await expect(addSshKey(USER, { publicKey: 42 })).rejects.toMatchObject({ statusCode: 400 })
    })

    it.each([
      ['an RSA key', 'ssh-rsa AAAAB3NzaC1yc2E= user@host'],
      ['garbage', 'not-a-key-at-all'],
      ['a truncated ed25519 blob', 'ssh-ed25519 AAAA'],
    ])('rejects %s with 400 and stores nothing', async (_label, publicKey) => {
      await expect(addSshKey(USER, { publicKey })).rejects.toMatchObject({ statusCode: 400 })
      expect(await (await sshKeyStore()).findByUser(USER)).toEqual([])
    })

    it('rejects a key that is already registered — even for a different user', async () => {
      const key = generateSshEd25519Key()
      await addSshKey(USER, { publicKey: key.publicKeySsh })
      await expect(addSshKey('other@example.com', { publicKey: key.publicKeySsh }))
        .rejects
        .toMatchObject({ statusCode: 409 })
      expect(await (await sshKeyStore()).findByUser('other@example.com')).toEqual([])
    })

    it('rejects an empty email parameter with 400', async () => {
      const { default: handler } = await import('../src/runtime/server/api/admin/users/[email]/ssh-keys.post')
      await expect(handler(asAdmin({ params: { email: '' }, body: {} })))
        .rejects
        .toMatchObject({ statusCode: 400 })
    })
  })

  describe('DELETE /users/:email/ssh-keys/:keyId', () => {
    it('removes the key from the store and from the user index', async () => {
      const key = generateSshEd25519Key()
      const saved = await addSshKey(USER, { publicKey: key.publicKeySsh })

      expect(await deleteSshKey(saved.keyId)).toEqual({ ok: true })
      expect(await (await sshKeyStore()).findById(saved.keyId)).toBeNull()
      expect(await (await sshKeyStore()).findByUser(USER)).toEqual([])
    })

    it('returns 404 for an unknown key', async () => {
      await expect(deleteSshKey('deadbeef')).rejects.toMatchObject({ statusCode: 404 })
    })

    it('rejects a missing keyId with 400', async () => {
      const { default: handler } = await import('../src/runtime/server/api/admin/users/[email]/ssh-keys/[keyId].delete')
      await expect(handler(asAdmin({ params: {} }))).rejects.toMatchObject({ statusCode: 400 })
    })
  })
})
