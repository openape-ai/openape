import { safeStorage } from 'electron'
import { CredentialCache } from './cache'

export function createMacOSCredentialCache(root: string): CredentialCache {
  return new CredentialCache(root, {
    available: () => process.platform === 'darwin' && safeStorage.isEncryptionAvailable(),
    encrypt: value => safeStorage.encryptString(value),
    decrypt: value => safeStorage.decryptString(value),
  })
}
