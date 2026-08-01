// Security checklist: native ed25519 signature verification — SSH public
// key parsing, raw signature checks, and the SSHSIG envelope produced by
// `ssh-keygen -Y sign` (namespace binding, magic/version validation).

import { describe, expect, it } from 'vitest'
import { sshEd25519ToKeyObject, verifyEd25519Signature } from '../src/runtime/server/utils/ed25519'
import { verifySSHSignature } from '../src/runtime/server/utils/sshsig'
import { generateSshEd25519Key } from './helpers/ssh-ed25519'

function wire(data: Buffer | string): Buffer {
  const buf = typeof data === 'string' ? Buffer.from(data) : data
  const len = Buffer.alloc(4)
  len.writeUInt32BE(buf.length)
  return Buffer.concat([len, buf])
}

describe('ed25519 SSH key handling', () => {
  it('verifies a signature made with the matching key', () => {
    const key = generateSshEd25519Key()
    const signature = key.sign('challenge-data')
    expect(verifyEd25519Signature(key.publicKeySsh, 'challenge-data', signature)).toBe(true)
  })

  it('rejects a signature made with a different key', () => {
    const key = generateSshEd25519Key()
    const wrongKey = generateSshEd25519Key()
    const signature = wrongKey.sign('challenge-data')
    expect(verifyEd25519Signature(key.publicKeySsh, 'challenge-data', signature)).toBe(false)
  })

  it('rejects a valid signature over different data', () => {
    const key = generateSshEd25519Key()
    const signature = key.sign('challenge-data')
    expect(verifyEd25519Signature(key.publicKeySsh, 'other-data', signature)).toBe(false)
  })

  it('parses a valid SSH public key into a KeyObject', () => {
    const key = generateSshEd25519Key()
    const keyObject = sshEd25519ToKeyObject(key.publicKeySsh)
    expect(keyObject.asymmetricKeyType).toBe('ed25519')
  })

  it('rejects non-ed25519 key types', () => {
    expect(() => sshEd25519ToKeyObject('ssh-rsa AAAAB3NzaC1yc2E comment')).toThrow('Not an ssh-ed25519 key')
  })

  it('rejects a key whose wire format lies about its type', () => {
    const blob = Buffer.concat([wire('ssh-rsa'), wire(Buffer.alloc(32))])
    expect(() => sshEd25519ToKeyObject(`ssh-ed25519 ${blob.toString('base64')}`))
      .toThrow('Unexpected key type')
  })

  it('rejects a key with a truncated raw key', () => {
    const blob = Buffer.concat([wire('ssh-ed25519'), wire(Buffer.alloc(16))])
    expect(() => sshEd25519ToKeyObject(`ssh-ed25519 ${blob.toString('base64')}`))
      .toThrow('Expected 32-byte ed25519 key')
  })
})

describe('sshsig envelope verification', () => {
  it('verifies an envelope for the right namespace', () => {
    const key = generateSshEd25519Key()
    const pem = key.signSshSig('challenge-data', 'openape')
    expect(verifySSHSignature(key.publicKeySsh, 'challenge-data', pem, 'openape')).toBe(true)
  })

  it('rejects an envelope signed for a different namespace', () => {
    const key = generateSshEd25519Key()
    const pem = key.signSshSig('challenge-data', 'file')
    expect(verifySSHSignature(key.publicKeySsh, 'challenge-data', pem, 'openape')).toBe(false)
  })

  it('rejects an envelope over different data', () => {
    const key = generateSshEd25519Key()
    const pem = key.signSshSig('challenge-data', 'openape')
    expect(verifySSHSignature(key.publicKeySsh, 'tampered-data', pem, 'openape')).toBe(false)
  })

  it('rejects an envelope verified against a different key', () => {
    const key = generateSshEd25519Key()
    const wrongKey = generateSshEd25519Key()
    const pem = key.signSshSig('challenge-data', 'openape')
    expect(verifySSHSignature(wrongKey.publicKeySsh, 'challenge-data', pem, 'openape')).toBe(false)
  })

  it('rejects a blob without the SSHSIG magic', () => {
    const b64 = Buffer.from('not-an-sshsig-blob-at-all').toString('base64')
    const pem = `-----BEGIN SSH SIGNATURE-----\n${b64}\n-----END SSH SIGNATURE-----`
    const key = generateSshEd25519Key()
    expect(verifySSHSignature(key.publicKeySsh, 'challenge-data', pem, 'openape')).toBe(false)
  })

  it('rejects an unsupported envelope version', () => {
    const key = generateSshEd25519Key()
    const pem = key.signSshSig('challenge-data', 'openape')
    const blob = Buffer.from(
      pem.replace(/-----(BEGIN|END) SSH SIGNATURE-----/g, '').replace(/\s/g, ''),
      'base64',
    )
    blob.writeUInt32BE(2, 6) // bump version 1 → 2
    const tampered = `-----BEGIN SSH SIGNATURE-----\n${blob.toString('base64')}\n-----END SSH SIGNATURE-----`
    expect(verifySSHSignature(key.publicKeySsh, 'challenge-data', tampered, 'openape')).toBe(false)
  })
})
