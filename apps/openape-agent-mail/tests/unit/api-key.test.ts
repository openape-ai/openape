import { describe, expect, it } from 'vitest'
import { generateApiKey, hashApiKey } from '../../server/utils/api-key'

describe('api-key', () => {
  describe('generateApiKey', () => {
    it('returns a key with amk_ prefix', () => {
      const { key } = generateApiKey()
      expect(key).toMatch(/^amk_/)
    })

    it('returns a SHA-256 hex hash', () => {
      const { hash } = generateApiKey()
      expect(hash).toMatch(/^[a-f0-9]{64}$/)
    })

    it('hash matches re-hashing the key', () => {
      const { key, hash } = generateApiKey()
      expect(hashApiKey(key)).toBe(hash)
    })

    it('generates unique keys', () => {
      const keys = new Set(Array.from({ length: 10 }, () => generateApiKey().key))
      expect(keys.size).toBe(10)
    })
  })

  describe('hashApiKey', () => {
    it('is deterministic', () => {
      const key = 'amk_test-key-123'
      expect(hashApiKey(key)).toBe(hashApiKey(key))
    })

    it('produces different hashes for different keys', () => {
      expect(hashApiKey('amk_key-a')).not.toBe(hashApiKey('amk_key-b'))
    })
  })
})
