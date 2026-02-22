import { createPublicKey, verify, type KeyObject } from 'node:crypto'

// Ed25519 OID prefix for SPKI DER encoding: 302a300506032b6570032100
const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex')

/**
 * Parse an SSH ed25519 public key string into a Node.js KeyObject.
 * Input format: "ssh-ed25519 AAAA... comment"
 */
function parseSSHEd25519PublicKey(sshKey: string): KeyObject {
  const parts = sshKey.trim().split(/\s+/)
  if (parts[0] !== 'ssh-ed25519' || !parts[1]) {
    throw new Error('Not an ssh-ed25519 key')
  }

  const wireFormat = Buffer.from(parts[1], 'base64')

  // SSH wire format: uint32 length + "ssh-ed25519" + uint32 length + 32-byte raw key
  let offset = 0
  const typeLen = wireFormat.readUInt32BE(offset)
  offset += 4
  const keyType = wireFormat.subarray(offset, offset + typeLen).toString()
  offset += typeLen

  if (keyType !== 'ssh-ed25519') {
    throw new Error(`Unexpected key type in wire format: ${keyType}`)
  }

  const keyLen = wireFormat.readUInt32BE(offset)
  offset += 4
  const rawKey = wireFormat.subarray(offset, offset + keyLen)

  if (rawKey.length !== 32) {
    throw new Error(`Expected 32-byte ed25519 key, got ${rawKey.length}`)
  }

  // Wrap raw 32-byte key in SPKI DER
  const spkiDer = Buffer.concat([ED25519_SPKI_PREFIX, rawKey])

  return createPublicKey({
    key: spkiDer,
    format: 'der',
    type: 'spki',
  })
}

/**
 * Verify an ed25519 signature using an SSH public key string.
 */
export function verifyEd25519Signature(
  sshPublicKey: string,
  data: Buffer | string,
  signature: Buffer,
): boolean {
  const pubKey = parseSSHEd25519PublicKey(sshPublicKey)
  const dataBuffer = typeof data === 'string' ? Buffer.from(data) : data
  return verify(null, dataBuffer, pubKey, signature)
}
