import { existsSync, readdirSync } from 'node:fs'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { safeStorage } from 'electron'
import { CredentialCache } from './connections/cache'

// Until issue 1519 Pods kept secrets in the macOS keychain through Electron safeStorage; these files are that retired format.
export function hasKeychainLegacy(root: string): boolean {
  if (existsSync(join(root, 'remote/registration.enc'))) return true
  try { return readdirSync(join(root, 'credentials')).some(name => name.endsWith('.encrypted')) }
  catch { return false }
}

/**
 * Moves the retired keychain files of a profile into private files, once. Only a Developer ID signed build opens
 * them without a keychain prompt. Returns what could not be migrated; a failed registration stays for the next start.
 */
export async function migrateKeychain(root: string): Promise<string[]> {
  if (process.platform !== 'darwin' || !safeStorage.isEncryptionAvailable()) return ['the macOS keychain is unavailable']
  const cache = new CredentialCache(join(root, 'credentials'), { available: () => true, decrypt: value => safeStorage.decryptString(value) })
  const failed = (await cache.migrateLegacy()).map(id => `credential ${id}`)
  const remote = join(root, 'remote'); const legacy = join(remote, 'registration.enc')
  if (!existsSync(legacy)) return failed
  try {
    if (!existsSync(join(remote, 'registration.json'))) {
      const text = safeStorage.decryptString(await readFile(legacy)); JSON.parse(text)
      await writeFile(join(remote, 'registration.pending'), text, { mode: 0o600 })
      await rename(join(remote, 'registration.pending'), join(remote, 'registration.json'))
    }
    await mkdir(join(remote, 'legacy'), { recursive: true, mode: 0o700 })
    await rename(legacy, join(remote, 'legacy/registration.enc'))
  }
  catch { failed.push('desktop registration') }
  return failed
}
