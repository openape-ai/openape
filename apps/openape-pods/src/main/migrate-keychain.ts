import { existsSync, readdirSync } from 'node:fs'
import { mkdir, open, readFile, rename } from 'node:fs/promises'
import { join } from 'node:path'
import { safeStorage } from 'electron'
import { CredentialCache } from './connections/cache'

// Until issue 1519 Pods kept secrets in the macOS keychain through Electron safeStorage; these files are that retired format.
export function hasKeychainLegacy(root: string): boolean {
  if (existsSync(join(root, 'remote/registration.enc'))) return true
  try { return readdirSync(join(root, 'credentials')).some(name => /^[a-f0-9-]{36}\.encrypted$/.test(name)) }
  catch { return false }
}

async function durable(path: string, text: string): Promise<void> {
  const staging = `${path}.pending`; const file = await open(staging, 'w', 0o600)
  try { await file.writeFile(text); await file.sync() }
  finally { await file.close() }
  await rename(staging, path)
  const directory = await open(join(path, '..'), 'r')
  try { await directory.sync() }
  finally { await directory.close() }
}

/**
 * Moves the retired keychain files of a profile into private files, once. Only a Developer ID signed build opens
 * them without a keychain prompt. What cannot be opened moves to a legacy/failed folder, so the keychain is never
 * needed again and nothing is lost; while the keychain is unavailable everything stays for the next start.
 */
export async function migrateKeychain(root: string): Promise<string[]> {
  if (process.platform !== 'darwin' || !safeStorage.isEncryptionAvailable()) return ['the macOS keychain is unavailable']
  const cache = new CredentialCache(join(root, 'credentials'), { available: () => true, decrypt: value => safeStorage.decryptString(value) })
  const failed = (await cache.migrateLegacy()).map(id => `credential ${id}`)
  const remote = join(root, 'remote'); const legacy = join(remote, 'registration.enc')
  if (!existsSync(legacy)) return failed
  let folder = 'legacy'
  try {
    const text = safeStorage.decryptString(await readFile(legacy)); JSON.parse(text)
    if (!existsSync(join(remote, 'registration.json'))) await durable(join(remote, 'registration.json'), text)
    if (await readFile(join(remote, 'registration.json'), 'utf8') !== text) throw new Error('Migrated registration differs')
  }
  catch { failed.push('desktop registration'); folder = 'legacy/failed' }
  await mkdir(join(remote, folder), { recursive: true, mode: 0o700 })
  await rename(legacy, join(remote, folder, 'registration.enc'))
  return failed
}
