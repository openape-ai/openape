import { createCipheriv, createDecipheriv, pbkdf2Sync } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import type { CredentialCipher } from '../main/connections/cache'

// Chromium 144 OSCrypt macOS v10: PBKDF2-HMAC-SHA1, 1003 iterations, AES-128-CBC.
// https://chromium.googlesource.com/chromium/src/+/144.0.7559.236/components/os_crypt/sync/os_crypt_mac.mm
export function safeStorageCipher(password: () => Buffer): CredentialCipher {
  let key: Buffer | undefined
  const encryptionKey = () => {
    if (!key) {
      const bytes = password()
      try { key = pbkdf2Sync(bytes, 'saltysalt', 1003, 16, 'sha1') }
      finally { bytes.fill(0) }
    }
    return key
  }
  return {
    available: () => process.platform === 'darwin',
    encrypt: (value) => {
      if (!value) return Buffer.alloc(0)
      const cipher = createCipheriv('aes-128-cbc', encryptionKey(), Buffer.alloc(16, 32))
      return Buffer.concat([Buffer.from('v10'), cipher.update(value, 'utf8'), cipher.final()])
    },
    decrypt: (value) => {
      if (!value.length) return ''
      if (value.subarray(0, 3).toString() !== 'v10') throw new Error('Unsupported Pods identity encryption; no migration was performed')
      const cipher = createDecipheriv('aes-128-cbc', encryptionKey(), Buffer.alloc(16, 32))
      try { return Buffer.concat([cipher.update(value.subarray(3)), cipher.final()]).toString('utf8') }
      catch { throw new Error('Cannot decrypt the existing Pods identity; use its original keychain') }
    },
  }
}

export function macOSCipher(helper: string): CredentialCipher {
  return safeStorageCipher(() => {
    try { return execFileSync(helper, [], { stdio: ['ignore', 'pipe', 'pipe'], timeout: 3000, maxBuffer: 4096 }) }
    catch { throw new Error('Pods identity keychain is locked, missing or denies CLI access; no key was created or changed') }
  })
}
