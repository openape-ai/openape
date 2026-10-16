import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID, randomBytes, createCipheriv, createDecipheriv } from 'node:crypto'
import { expect, it } from 'vitest'
import { CredentialCache } from '../../src/main/connections/cache'

it('encrypts named pod credentials, returns only the bound value and deletes only the owning pod record', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pods-secret-cache-')); const key = randomBytes(32)
  const cipher = { available: () => true, encrypt: (value: string) => { const iv = randomBytes(12); const encrypt = createCipheriv('aes-256-gcm', key, iv); return Buffer.concat([iv, encrypt.update(value), encrypt.final(), encrypt.getAuthTag()]) }, decrypt: (value: Buffer) => { const decrypt = createDecipheriv('aes-256-gcm', key, value.subarray(0, 12)); decrypt.setAuthTag(value.subarray(-16)); return Buffer.concat([decrypt.update(value.subarray(12, -16)), decrypt.final()]).toString() } }
  try {
    const one = randomUUID(); const two = randomUUID(); const cache = new CredentialCache(root, cipher)
    const id = await cache.createScriptSecret(one, 'crm', 'synthetic-private-one')
    const other = await cache.createScriptSecret(two, 'crm', 'synthetic-private-two')
    expect((await readFile(join(root, `${id}.encrypted`))).includes('synthetic-private-one')).toBe(false)
    const reopened = new CredentialCache(root, cipher)
    expect(await reopened.readScriptSecret(id, one, 'crm')).toBe('synthetic-private-one')
    await expect(reopened.readScriptSecret(id, two, 'crm')).rejects.toThrow('another pod')
    await expect(reopened.readScriptSecret(id, one, 'other')).rejects.toThrow('alias')
    await expect(reopened.erasePodKey(id, two)).rejects.toThrow('foreign')
    await reopened.erasePodKey(id, one); expect(await readdir(root)).not.toContain(`${id}.encrypted`)
    expect(await reopened.readScriptSecret(other, two, 'crm')).toBe('synthetic-private-two')
    const orphan = await cache.createScriptSecret(one, 'orphan', 'synthetic-orphan')
    await reopened.reconcileScriptSecrets([{ id: other, podId: two }])
    expect(await readdir(root)).not.toContain(`${orphan}.encrypted`)
    expect(await reopened.readScriptSecret(other, two, 'crm')).toBe('synthetic-private-two')
    const oauth = randomUUID(); await cache.create(oauth, JSON.stringify({ access_token: 'synthetic-provider-token' }))
    await expect(reopened.readScriptSecret(oauth, one, 'crm')).rejects.toThrow('another pod')
  }
  finally { await rm(root, { recursive: true, force: true }) }
})

it('migrates only Pod identities and reopens them without a cipher while retaining keys and bindings', async () => {
  const { mkdir, writeFile, stat } = await import('node:fs/promises')
  const { vi } = await import('vitest')
  const root = await mkdtemp(join(tmpdir(), 'pods-identity-migration-'))
  const id = randomUUID(); const secretId = randomUUID()
  const identity = { podId: randomUUID(), issuer: 'https://id.example.test', owner: 'owner@example.test', privateKey: 'SYNTHETIC_KEY', publicKey: 'SYNTHETIC_PUBLIC', keyId: 'synthetic-key-id', subject: 'pod@example.test', accessToken: 'SYNTHETIC_TOKEN', expiresAt: 1 }
  const cipher = { available: () => true, encrypt: (value: string) => Buffer.from(value).reverse(), decrypt: (value: Buffer) => Buffer.from(value).reverse().toString() }
  const unavailable = { available: () => false, encrypt: vi.fn(() => { throw new Error('Must not encrypt') }), decrypt: vi.fn(() => { throw new Error('Must not decrypt') }) }
  try {
    await mkdir(root, { recursive: true, mode: 0o700 })
    const legacy = join(root, `${id}.encrypted`); const current = join(root, `${id}.identity.json`)
    await writeFile(legacy, cipher.encrypt(JSON.stringify(identity)), { mode: 0o600 })
    const before = await readFile(legacy)
    const cli = new CredentialCache(root, unavailable)
    await expect(cli.readConnection(id)).rejects.toThrow('updated desktop once')
    expect(await readFile(legacy)).toEqual(before)
    const desktop = new CredentialCache(root, cipher)
    await desktop.create(secretId, JSON.stringify({ accessToken: 'OTHER_SYNTHETIC_TOKEN' }))
    expect(await desktop.readConnection(id)).toEqual(identity)
    expect(await readdir(root)).not.toContain(`${id}.encrypted`)
    expect(await readdir(root)).toContain(`${secretId}.encrypted`)
    expect((await stat(current)).mode & 0o777).toBe(0o600)
    expect((await stat(root)).mode & 0o777).toBe(0o700)
    expect(await cli.readConnection(id)).toEqual(identity)
    await cli.withCache(id, async (file) => {
      const value = JSON.parse(await readFile(file, 'utf8')); value.accessToken = 'REFRESHED_SYNTHETIC_TOKEN'
      await writeFile(file, JSON.stringify(value))
    })
    expect(await new CredentialCache(root, unavailable).readConnection(id)).toEqual({ ...identity, accessToken: 'REFRESHED_SYNTHETIC_TOKEN' })
    await expect(cli.erasePodKey(id, randomUUID())).rejects.toThrow('foreign')
    expect(await cli.readConnection(id)).toMatchObject({ privateKey: identity.privateKey })
    await expect(desktop.connect(id, JSON.stringify({ value: 'not-an-identity' }))).rejects.toThrow('Cannot replace')
    await cli.erasePodKey(id, identity.podId)
    expect(await readdir(root)).not.toContain(`${id}.identity.json`)
    await cli.create(id, JSON.stringify(identity))
    expect(await cli.readConnection(id)).toEqual(identity)
    expect(unavailable.encrypt).not.toHaveBeenCalled(); expect(unavailable.decrypt).not.toHaveBeenCalled()
  }
  finally { await rm(root, { recursive: true, force: true }) }
})

it('refuses unsafe or corrupt identity files without falling back to an encrypted copy', async () => {
  const { chmod, writeFile, symlink, link } = await import('node:fs/promises')
  const { vi } = await import('vitest')
  const root = await mkdtemp(join(tmpdir(), 'pods-identity-refusal-'))
  const id = randomUUID()
  const identity = { podId: randomUUID(), issuer: 'https://id.example.test', owner: 'owner@example.test', privateKey: 'SYNTHETIC_KEY', publicKey: 'SYNTHETIC_PUBLIC', keyId: 'key' }
  const decrypt = vi.fn(() => JSON.stringify(identity))
  const cache = new CredentialCache(root, { available: () => true, encrypt: Buffer.from, decrypt })
  try {
    await cache.create(id, JSON.stringify(identity))
    const current = join(root, `${id}.identity.json`)
    await writeFile(join(root, `${id}.encrypted`), 'SYNTHETIC_LEGACY')
    await chmod(current, 0o644)
    await expect(cache.readConnection(id)).rejects.toThrow('private')
    await chmod(current, 0o600)
    await chmod(root, 0o755)
    await expect(cache.readConnection(id)).rejects.toThrow('private')
    await chmod(root, 0o700)
    await writeFile(current, 'invalid-json')
    await expect(cache.readConnection(id)).rejects.toThrow('Invalid credential')
    await rm(current)
    const target = join(root, 'target.json'); await writeFile(target, JSON.stringify(identity), { mode: 0o600 })
    await symlink(target, current)
    await expect(cache.readConnection(id)).rejects.toThrow()
    await rm(current); await link(target, current)
    await expect(cache.readConnection(id)).rejects.toThrow('single link')
    expect(decrypt).not.toHaveBeenCalled()
  }
  finally { await rm(root, { recursive: true, force: true }) }
})

it('preserves legacy identities when decryption or atomic publication fails', async () => {
  const { writeFile } = await import('node:fs/promises')
  const { mkdirSync } = await import('node:fs')
  const root = await mkdtemp(join(tmpdir(), 'pods-identity-failed-migration-'))
  const id = randomUUID(); const path = join(root, `${id}.encrypted`)
  const identity = { podId: randomUUID(), issuer: 'https://id.example.test', owner: 'owner@example.test', privateKey: 'SYNTHETIC_KEY', publicKey: 'SYNTHETIC_PUBLIC', keyId: 'key' }
  try {
    await writeFile(path, 'SYNTHETIC_ENCRYPTED')
    const failed = new CredentialCache(root, { available: () => true, encrypt: Buffer.from, decrypt: () => { throw new Error('Denied legacy decryption') } })
    await expect(failed.readConnection(id)).rejects.toThrow('Denied')
    expect(await readFile(path, 'utf8')).toBe('SYNTHETIC_ENCRYPTED')
    const conflict = join(root, `${id}.identity.json`)
    const migration = new CredentialCache(root, { available: () => true, encrypt: Buffer.from, decrypt: () => { mkdirSync(conflict); return JSON.stringify(identity) } })
    await expect(migration.readConnection(id)).rejects.toThrow()
    expect(await readFile(path, 'utf8')).toBe('SYNTHETIC_ENCRYPTED')
    expect((await readdir(root)).filter(file => file.startsWith('.stage-'))).toEqual([])
  }
  finally { await rm(root, { recursive: true, force: true }) }
})
