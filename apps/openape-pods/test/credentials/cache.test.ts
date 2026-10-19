import { mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { expect, it } from 'vitest'
import { CredentialCache } from '../../src/main/connections/cache'

it('stores named pod credentials as private files, returns only the bound value and deletes only the owning pod record', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pods-secret-cache-'))
  try {
    const one = randomUUID(); const two = randomUUID(); const cache = new CredentialCache(root)
    const id = await cache.createScriptSecret(one, 'crm', 'synthetic-private-one')
    const other = await cache.createScriptSecret(two, 'crm', 'synthetic-private-two')
    expect((await stat(join(root, `${id}.connection.json`))).mode & 0o777).toBe(0o600)
    expect((await stat(root)).mode & 0o777).toBe(0o700)
    const reopened = new CredentialCache(root)
    expect(await reopened.readScriptSecret(id, one, 'crm')).toBe('synthetic-private-one')
    await expect(reopened.readScriptSecret(id, two, 'crm')).rejects.toThrow('another pod')
    await expect(reopened.readScriptSecret(id, one, 'other')).rejects.toThrow('alias')
    await expect(reopened.erasePodKey(id, two)).rejects.toThrow('foreign')
    await reopened.erasePodKey(id, one); expect(await readdir(root)).not.toContain(`${id}.connection.json`)
    expect(await reopened.readScriptSecret(other, two, 'crm')).toBe('synthetic-private-two')
    const orphan = await cache.createScriptSecret(one, 'orphan', 'synthetic-orphan')
    await reopened.reconcileScriptSecrets([{ id: other, podId: two }])
    expect(await readdir(root)).not.toContain(`${orphan}.connection.json`)
    expect(await reopened.readScriptSecret(other, two, 'crm')).toBe('synthetic-private-two')
    const oauth = randomUUID(); await cache.create(oauth, JSON.stringify({ access_token: 'synthetic-provider-token' }))
    await expect(reopened.readScriptSecret(oauth, one, 'crm')).rejects.toThrow('another pod')
  }
  finally { await rm(root, { recursive: true, force: true }) }
})

it('migrates retired keychain values once, keeps the legacy file aside and reopens them without a cipher', async () => {
  const { mkdir, writeFile, stat } = await import('node:fs/promises')
  const { vi } = await import('vitest')
  const root = await mkdtemp(join(tmpdir(), 'pods-identity-migration-'))
  const id = randomUUID(); const secretId = randomUUID()
  const identity = { podId: randomUUID(), issuer: 'https://id.example.test', owner: 'owner@example.test', privateKey: 'SYNTHETIC_KEY', publicKey: 'SYNTHETIC_PUBLIC', keyId: 'synthetic-key-id', subject: 'pod@example.test', accessToken: 'SYNTHETIC_TOKEN', expiresAt: 1 }
  const encrypt = (value: string) => Buffer.from(value).reverse()
  const cipher = { available: () => true, decrypt: (value: Buffer) => Buffer.from(value).reverse().toString() }
  const unavailable = { available: () => false, decrypt: vi.fn(() => { throw new Error('Must not decrypt') }) }
  try {
    await mkdir(root, { recursive: true, mode: 0o700 })
    const legacy = join(root, `${id}.encrypted`); const current = join(root, `${id}.identity.json`)
    await writeFile(legacy, encrypt(JSON.stringify(identity)), { mode: 0o600 })
    const before = await readFile(legacy)
    const cli = new CredentialCache(root, unavailable)
    await expect(cli.readConnection(id)).rejects.toThrow('still in the macOS keychain')
    expect(await readFile(legacy)).toEqual(before)
    const desktop = new CredentialCache(root, cipher)
    await desktop.create(secretId, JSON.stringify({ accessToken: 'OTHER_SYNTHETIC_TOKEN' }))
    expect(await desktop.readConnection(id)).toEqual(identity)
    expect(await readdir(root)).not.toContain(`${id}.encrypted`)
    expect(await readFile(join(root, 'legacy', `${id}.encrypted`))).toEqual(before)
    expect(await readdir(root)).toContain(`${secretId}.connection.json`)
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
    expect(unavailable.decrypt).not.toHaveBeenCalled()
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
  const cache = new CredentialCache(root, { available: () => true, decrypt })
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
    const failed = new CredentialCache(root, { available: () => true, decrypt: () => { throw new Error('Denied legacy decryption') } })
    await expect(failed.readConnection(id)).rejects.toThrow('Denied')
    expect(await readFile(path, 'utf8')).toBe('SYNTHETIC_ENCRYPTED')
    const conflict = join(root, `${id}.identity.json`)
    const migration = new CredentialCache(root, { available: () => true, decrypt: () => { mkdirSync(conflict); return JSON.stringify(identity) } })
    await expect(migration.readConnection(id)).rejects.toThrow()
    expect(await readFile(path, 'utf8')).toBe('SYNTHETIC_ENCRYPTED')
    expect((await readdir(root)).filter(file => file.startsWith('.stage-'))).toEqual([])
  }
  finally { await rm(root, { recursive: true, force: true }) }
})

it('migrates selected HTTP and model records, persists refresh across runtimes and erases every representation', async () => {
  const { writeFile, stat } = await import('node:fs/promises')
  const root = await mkdtemp(join(tmpdir(), 'pods-portable-provider-'))
  const pod = randomUUID(); const model = randomUUID(); const unrelated = randomUUID()
  const auth = { auth_mode: 'chatgpt', tokens: { account_id: 'synthetic-account', access_token: 'synthetic-access', refresh_token: 'synthetic-refresh' } }
  try {
    const desktop = new CredentialCache(root)
    const http = await desktop.createScriptSecret(pod, 'destination', 'synthetic-agent-key')
    await desktop.create(model, JSON.stringify(auth)); await desktop.create(unrelated, JSON.stringify({ kind: 'program-state', podId: pod }))
    const cli = new CredentialCache(root)
    await expect(desktop.migrateHttp(http, randomUUID(), 'destination')).rejects.toThrow('binding')
    await expect(desktop.migrateHttp(http, pod, 'other')).rejects.toThrow('binding')
    await expect(desktop.migrateChatgpt(model, 'foreign-account')).rejects.toThrow('binding')
    expect(await readdir(root)).not.toContain(`${http}.credential.json`)
    await desktop.migrateHttp(http, pod, 'destination'); await desktop.migrateChatgpt(model, 'synthetic-account')
    expect(await cli.readHttpSecret(http, pod, 'destination')).toBe('synthetic-agent-key')
    await expect(cli.migrateHttp(model, pod, 'destination')).rejects.toThrow('kind')
    await expect(cli.migrateChatgpt(model, 'foreign-account')).rejects.toThrow('binding')
    expect(await cli.readConnection(unrelated)).toMatchObject({ kind: 'program-state', podId: pod })
    for (const id of [model, http]) {
      expect((await stat(join(root, `${id}.credential.json`))).mode & 0o777).toBe(0o600)
      expect(await readdir(root)).not.toContain(`${id}.connection.json`)
    }
    await cli.withCache(model, async (file) => { await writeFile(file, JSON.stringify({ ...auth, tokens: { ...auth.tokens, refresh_token: 'refreshed-synthetic' } })) })
    expect(await new CredentialCache(root).readConnection(model)).toMatchObject({ tokens: { refresh_token: 'refreshed-synthetic' } })
    await expect(cli.withCache(model, async (file) => { await writeFile(file, JSON.stringify({ ...auth, tokens: { ...auth.tokens, account_id: 'foreign' } })) })).rejects.toThrow('binding')
    expect(await cli.readConnection(model)).toMatchObject({ tokens: { account_id: 'synthetic-account', refresh_token: 'refreshed-synthetic' } })
    await writeFile(join(root, `${http}.connection.json`), JSON.stringify({ kind: 'script-credential', podId: pod, alias: 'destination', value: 'stale-synthetic-key' }), { mode: 0o600 })
    expect(await cli.readHttpSecret(http, pod, 'destination')).toBe('synthetic-agent-key')
    await expect(cli.erasePodKey(http, randomUUID())).rejects.toThrow('foreign')
    await cli.erasePodKey(http, pod); await cli.eraseConnection(model)
    await expect(cli.readConnection(http)).rejects.toThrow(); await expect(desktop.readConnection(model)).rejects.toThrow()
    expect(await readdir(join(root, 'temporary'))).toEqual([])
  }
  finally { await rm(root, { recursive: true, force: true }) }
})

it('refuses corrupt, linked, substituted or public portable credentials without stale cipher fallback', async () => {
  const { chmod, writeFile, symlink, link } = await import('node:fs/promises')
  const { vi } = await import('vitest')
  const root = await mkdtemp(join(tmpdir(), 'pods-portable-refusal-'))
  const id = randomUUID(); const auth = { tokens: { account_id: 'synthetic-account', access_token: 'synthetic-access', refresh_token: 'synthetic-refresh' } }
  const decrypt = vi.fn((value: Buffer) => value.toString())
  try {
    const cache = new CredentialCache(root, { available: () => true, decrypt })
    await cache.create(id, JSON.stringify(auth)); await cache.migrateChatgpt(id, 'synthetic-account')
    const path = join(root, `${id}.credential.json`); const original = await readFile(path, 'utf8')
    await writeFile(join(root, `${id}.encrypted`), JSON.stringify(auth)); decrypt.mockClear()
    for (const corrupt of ['invalid', JSON.stringify({ ...JSON.parse(original), id: randomUUID() }), JSON.stringify({ ...JSON.parse(original), binding: { kind: 'http', podId: randomUUID(), alias: 'key' } })]) {
      await writeFile(path, corrupt)
      await expect(cache.readConnection(id)).rejects.toThrow()
    }
    await writeFile(path, original); await chmod(path, 0o644)
    await expect(cache.readConnection(id)).rejects.toThrow('private'); await chmod(path, 0o600)
    await chmod(root, 0o755); await expect(cache.readConnection(id)).rejects.toThrow('private'); await chmod(root, 0o700)
    const target = join(root, 'target'); await writeFile(target, original, { mode: 0o600 }); await rm(path); await symlink(target, path)
    await expect(cache.readConnection(id)).rejects.toThrow(); await rm(path); await link(target, path)
    await expect(cache.readConnection(id)).rejects.toThrow('single link')
    expect(decrypt).not.toHaveBeenCalled()
  }
  finally { await rm(root, { recursive: true, force: true }) }
})

it('preserves a retired keychain credential on failed migration and rejects cancelled queued refresh without persisting stale data', async () => {
  const { writeFile, mkdir } = await import('node:fs/promises')
  const root = await mkdtemp(join(tmpdir(), 'pods-portable-interrupted-'))
  const id = randomUUID(); const auth = { tokens: { account_id: 'synthetic-account', access_token: 'synthetic-access', refresh_token: 'synthetic-refresh' } }
  const cipher = { available: () => true, decrypt: (value: Buffer) => value.toString() }
  try {
    const cache = new CredentialCache(root, cipher)
    await mkdir(root, { recursive: true, mode: 0o700 }); await writeFile(join(root, `${id}.encrypted`), JSON.stringify(auth), { mode: 0o600 })
    const before = await readFile(join(root, `${id}.encrypted`))
    const failed = new CredentialCache(root, { ...cipher, decrypt: () => { throw new Error('Synthetic decryption refusal') } })
    await expect(failed.migrateChatgpt(id, 'synthetic-account')).rejects.toThrow('refusal')
    const conflict = join(root, `${id}.credential.json`)
    const interrupted = new CredentialCache(root, { ...cipher, decrypt: () => JSON.stringify(auth) })
    await mkdir(conflict)
    await expect(interrupted.migrateChatgpt(id, 'synthetic-account')).rejects.toThrow()
    expect(await readFile(join(root, `${id}.encrypted`))).toEqual(before)
    await rm(conflict, { recursive: true }); await cache.migrateChatgpt(id, 'synthetic-account')
    const cli = new CredentialCache(root); const controller = new AbortController()
    let release!: () => void
    const hold = new Promise<void>((resolve) => { release = resolve })
    let entered!: () => void
    const started = new Promise<void>((resolve) => { entered = resolve })
    const first = cli.withCache(id, async (file) => { entered(); await hold; await writeFile(file, JSON.stringify({ ...auth, tokens: { ...auth.tokens, refresh_token: 'new-synthetic' } })) })
    await started
    const second = cli.withCache(id, async () => { throw new Error('Must not enter cancelled operation') }, controller.signal)
    controller.abort(new Error('Synthetic cancellation')); await expect(second).rejects.toThrow('cancellation'); release(); await first
    expect(await cli.readConnection(id)).toMatchObject({ tokens: { refresh_token: 'new-synthetic' } })
    expect((await readdir(root)).filter(file => file.startsWith('.stage-'))).toEqual([])
  }
  finally { await rm(root, { recursive: true, force: true }) }
})
