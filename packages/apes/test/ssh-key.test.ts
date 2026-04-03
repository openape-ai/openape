import { generateKeyPairSync } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { loadEd25519PrivateKey } from '../src/ssh-key'

describe('loadEd25519PrivateKey', () => {
  it('loads a PKCS8 PEM key', () => {
    const { privateKey } = generateKeyPairSync('ed25519')
    const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }) as string

    const loaded = loadEd25519PrivateKey(pem)
    expect(loaded).toBeTruthy()
    expect(loaded.type).toBe('private')
    expect(loaded.asymmetricKeyType).toBe('ed25519')
  })

  it('loads an OpenSSH format key', () => {
    // Generate an Ed25519 key and manually construct OpenSSH format
    const { publicKey, privateKey } = generateKeyPairSync('ed25519')

    // Get raw key material via JWK
    const privJwk = privateKey.export({ format: 'jwk' }) as { d: string, x: string }
    const pubJwk = publicKey.export({ format: 'jwk' }) as { x: string }

    const seed = Buffer.from(privJwk.d, 'base64url')
    const pubBytes = Buffer.from(pubJwk.x, 'base64url')

    // Build OpenSSH key format manually
    const magic = Buffer.from('openssh-key-v1\0', 'ascii')

    // cipher: "none"
    const cipherName = Buffer.from('none')
    const cipherLen = Buffer.alloc(4)
    cipherLen.writeUInt32BE(cipherName.length)

    // kdf: "none"
    const kdfName = Buffer.from('none')
    const kdfLen = Buffer.alloc(4)
    kdfLen.writeUInt32BE(kdfName.length)

    // kdf options: empty
    const kdfOpts = Buffer.alloc(4) // length = 0

    // num keys: 1
    const numKeys = Buffer.alloc(4)
    numKeys.writeUInt32BE(1)

    // Public key section
    const keyType = Buffer.from('ssh-ed25519')
    const keyTypeLen = Buffer.alloc(4)
    keyTypeLen.writeUInt32BE(keyType.length)
    const pubKeyLen = Buffer.alloc(4)
    pubKeyLen.writeUInt32BE(pubBytes.length)
    const pubSection = Buffer.concat([keyTypeLen, keyType, pubKeyLen, pubBytes])
    const pubSectionLen = Buffer.alloc(4)
    pubSectionLen.writeUInt32BE(pubSection.length)

    // Private key section
    const checkInt = Buffer.alloc(4)
    const checkVal = Math.floor(Math.random() * 0xFFFFFFFF)
    checkInt.writeUInt32BE(checkVal)

    const privKeyType = Buffer.from('ssh-ed25519')
    const privKeyTypeLen = Buffer.alloc(4)
    privKeyTypeLen.writeUInt32BE(privKeyType.length)

    const privPubKeyLen = Buffer.alloc(4)
    privPubKeyLen.writeUInt32BE(pubBytes.length)

    // Private key is seed + pubkey (64 bytes)
    const privKeyData = Buffer.concat([seed, pubBytes])
    const privKeyDataLen = Buffer.alloc(4)
    privKeyDataLen.writeUInt32BE(privKeyData.length)

    // Comment (empty)
    const comment = Buffer.alloc(4) // length = 0

    // Padding
    const privContent = Buffer.concat([
      checkInt, checkInt, // two matching check integers
      privKeyTypeLen, privKeyType,
      privPubKeyLen, pubBytes,
      privKeyDataLen, privKeyData,
      comment,
    ])
    // Add padding to make length a multiple of 8
    const padLen = 8 - (privContent.length % 8)
    const padding = Buffer.alloc(padLen === 8 ? 0 : padLen)
    for (let i = 0; i < padding.length; i++) padding[i] = i + 1

    const privSection = Buffer.concat([privContent, padding])
    const privSectionLen = Buffer.alloc(4)
    privSectionLen.writeUInt32BE(privSection.length)

    const fullKey = Buffer.concat([
      magic,
      cipherLen, cipherName,
      kdfLen, kdfName,
      kdfOpts,
      numKeys,
      pubSectionLen, pubSection,
      privSectionLen, privSection,
    ])

    const pem = `-----BEGIN OPENSSH PRIVATE KEY-----\n${fullKey.toString('base64').match(/.{1,70}/g)!.join('\n')}\n-----END OPENSSH PRIVATE KEY-----\n`

    const loaded = loadEd25519PrivateKey(pem)
    expect(loaded).toBeTruthy()
    expect(loaded.type).toBe('private')
    expect(loaded.asymmetricKeyType).toBe('ed25519')
  })

  it('throws for encrypted OpenSSH keys', () => {
    // Construct a minimal OpenSSH key with cipher != "none"
    const magic = Buffer.from('openssh-key-v1\0', 'ascii')
    const cipher = Buffer.from('aes256-ctr')
    const cipherLen = Buffer.alloc(4)
    cipherLen.writeUInt32BE(cipher.length)
    const rest = Buffer.alloc(100) // dummy data
    const fullKey = Buffer.concat([magic, cipherLen, cipher, rest])

    const pem = `-----BEGIN OPENSSH PRIVATE KEY-----\n${fullKey.toString('base64')}\n-----END OPENSSH PRIVATE KEY-----\n`

    expect(() => loadEd25519PrivateKey(pem)).toThrow('Encrypted keys not supported')
  })

  it('throws for non-OpenSSH private key with wrong magic', () => {
    const badMagic = Buffer.from('not-openssh-key\0')
    const rest = Buffer.alloc(100)
    const fullKey = Buffer.concat([badMagic, rest])

    const pem = `-----BEGIN OPENSSH PRIVATE KEY-----\n${fullKey.toString('base64')}\n-----END OPENSSH PRIVATE KEY-----\n`

    expect(() => loadEd25519PrivateKey(pem)).toThrow('Not an OpenSSH private key')
  })
})
