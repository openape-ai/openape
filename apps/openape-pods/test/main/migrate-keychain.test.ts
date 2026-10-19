// @vitest-environment node
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { afterEach, expect, it, vi } from 'vitest'

// The retired format: values the login keychain key encrypted; reversed bytes stand in for that key here.
const keychain = vi.hoisted(() => ({ available: true }))
vi.mock('electron', () => ({ safeStorage: { isEncryptionAvailable: () => keychain.available, decryptString: (bytes: Buffer) => { if (bytes.toString() === 'corrupt') throw new Error('Synthetic decryption failure'); return Buffer.from(bytes).reverse().toString() } } }))
const { hasKeychainLegacy, migrateKeychain } = await import('../../src/main/migrate-keychain')
const { CredentialCache } = await import('../../src/main/connections/cache')

const roots: string[] = []
afterEach(async () => { keychain.available = true; for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }) })
const encrypt = (value: string) => Buffer.from(value).reverse()

async function profile() {
  const root = await mkdtemp(join(tmpdir(), 'pods-keychain-migration-')); roots.push(root)
  await mkdir(join(root, 'credentials'), { mode: 0o700 }); await mkdir(join(root, 'remote'), { mode: 0o700 })
  const identity = { podId: randomUUID(), issuer: 'https://id.example.test', owner: 'owner@example.test', privateKey: 'SYNTHETIC_KEY', publicKey: 'SYNTHETIC_PUBLIC', keyId: 'key' }
  const ids = { identity: randomUUID(), connection: randomUUID(), corrupt: randomUUID() }
  await writeFile(join(root, 'credentials', `${ids.identity}.encrypted`), encrypt(JSON.stringify(identity)), { mode: 0o600 })
  await writeFile(join(root, 'credentials', `${ids.connection}.encrypted`), encrypt(JSON.stringify({ kind: 'typesafe', key: 'SYNTHETIC_JEV' })), { mode: 0o600 })
  await writeFile(join(root, 'credentials', `${ids.corrupt}.encrypted`), 'corrupt', { mode: 0o600 })
  const registration = { id: randomUUID(), signing: 'SYNTHETIC_SIGNING', agreement: 'SYNTHETIC_AGREEMENT', enabled: true }
  await writeFile(join(root, 'remote/registration.enc'), encrypt(JSON.stringify(registration)), { mode: 0o600 })
  return { root, identity, ids, registration }
}

it('migrates every retired keychain file once into private files and needs the keychain never again', async () => {
  const { root, identity, ids, registration } = await profile()
  expect(hasKeychainLegacy(root)).toBe(true)
  expect(await migrateKeychain(root)).toEqual([`credential ${ids.corrupt}`])
  expect(hasKeychainLegacy(root)).toBe(false)
  const cache = new CredentialCache(join(root, 'credentials'))
  expect(await cache.readConnection(ids.identity)).toEqual(identity)
  expect(await cache.readConnection(ids.connection)).toEqual({ kind: 'typesafe', key: 'SYNTHETIC_JEV' })
  for (const file of [`credentials/${ids.identity}.identity.json`, `credentials/${ids.connection}.connection.json`, 'remote/registration.json']) expect((await stat(join(root, file))).mode & 0o777).toBe(0o600)
  expect(JSON.parse(await readFile(join(root, 'remote/registration.json'), 'utf8'))).toEqual(registration)
  // Nothing is deleted: the retired files stay aside for a rollback to the previous app.
  expect((await readdir(join(root, 'credentials/legacy'))).sort()).toEqual(Object.values(ids).map(id => `${id}.encrypted`).sort())
  expect(await readdir(join(root, 'remote/legacy'))).toEqual(['registration.enc'])
  expect(await migrateKeychain(root)).toEqual([])
})

it('leaves every retired file in place while the keychain is unavailable', async () => {
  const { root } = await profile()
  keychain.available = false
  expect(await migrateKeychain(root)).toEqual(['the macOS keychain is unavailable'])
  expect(hasKeychainLegacy(root)).toBe(true)
  expect((await readdir(join(root, 'credentials'))).filter(name => name.endsWith('.encrypted'))).toHaveLength(3)
  expect(await readdir(join(root, 'remote'))).toEqual(['registration.enc'])
})

it('keeps a registration it cannot open for the next start', async () => {
  const { root } = await profile()
  await writeFile(join(root, 'remote/registration.enc'), 'corrupt')
  expect(await migrateKeychain(root)).toContain('desktop registration')
  expect(await readdir(join(root, 'remote'))).toEqual(['registration.enc'])
  expect(hasKeychainLegacy(root)).toBe(true)
})
