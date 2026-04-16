import { createHash, createPublicKey, verify } from 'node:crypto'

const SSHSIG_MAGIC = 'SSHSIG'
const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex')

// SSH wire format helpers: each value is prefixed with a uint32 big-endian length.
function readString(buf: Buffer, offset: number): { value: Buffer, next: number } {
  const len = buf.readUInt32BE(offset)
  const value = buf.subarray(offset + 4, offset + 4 + len)
  return { value, next: offset + 4 + len }
}

function wireString(s: string): Buffer {
  const data = Buffer.from(s)
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  return Buffer.concat([len, data])
}

function wireBuffer(buf: Buffer): Buffer {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(buf.length)
  return Buffer.concat([len, buf])
}

/**
 * Verify an SSH signature produced by `ssh-keygen -Y sign`.
 *
 * The SSHSIG format wraps the Ed25519 signature with metadata (namespace,
 * hash algorithm) and signs a structured message rather than the raw data:
 *
 *   signed_data = "SSHSIG"
 *               + wire(namespace)
 *               + wire(reserved = "")
 *               + wire(hash_algorithm)
 *               + wire(hash(message))
 *
 * This function parses the PEM envelope, extracts the raw 64-byte Ed25519
 * signature, reconstructs the signed_data, and verifies using the known
 * SSH public key.  Uses only Node.js native crypto — no external deps.
 */
export function verifySSHSignature(
  sshPublicKey: string,
  message: string,
  signaturePem: string,
  expectedNamespace: string,
): boolean {
  // 1. Strip PEM armor and decode
  const b64 = signaturePem
    .replace(/-----BEGIN SSH SIGNATURE-----/, '')
    .replace(/-----END SSH SIGNATURE-----/, '')
    .replace(/\s/g, '')
  const blob = Buffer.from(b64, 'base64')

  let offset = 0

  // 2. Validate magic
  const magic = blob.subarray(offset, offset + 6).toString()
  if (magic !== SSHSIG_MAGIC) return false
  offset += 6

  // 3. Version (uint32, must be 1)
  const version = blob.readUInt32BE(offset)
  if (version !== 1) return false
  offset += 4

  // 4. Skip public key blob (we use the known key, not the embedded one)
  const pubKeyBlob = readString(blob, offset)
  offset = pubKeyBlob.next

  // 5. Namespace — must match expected
  const namespace = readString(blob, offset)
  offset = namespace.next
  if (namespace.value.toString() !== expectedNamespace) return false

  // 6. Reserved (should be empty)
  const reserved = readString(blob, offset)
  offset = reserved.next

  // 7. Hash algorithm
  const hashAlgo = readString(blob, offset)
  offset = hashAlgo.next
  const hashAlgoStr = hashAlgo.value.toString()

  // 8. Signature blob — contains: algo type string + raw signature
  const sigBlob = readString(blob, offset)
  const sigBlobBuf = sigBlob.value

  let sigOffset = 0
  const sigAlgo = readString(sigBlobBuf, sigOffset)
  sigOffset = sigAlgo.next
  if (sigAlgo.value.toString() !== 'ssh-ed25519') return false

  const rawSig = readString(sigBlobBuf, sigOffset)
  if (rawSig.value.length !== 64) return false

  // 9. Reconstruct the signed message
  const messageHash = createHash(hashAlgoStr.replace('-', ''))
    .update(Buffer.from(message))
    .digest()

  const signedData = Buffer.concat([
    Buffer.from(SSHSIG_MAGIC),
    wireString(expectedNamespace),
    wireString(''), // reserved
    wireString(hashAlgoStr),
    wireBuffer(messageHash),
  ])

  // 10. Parse public key and verify
  const parts = sshPublicKey.trim().split(/\s+/)
  if (parts[0] !== 'ssh-ed25519' || !parts[1]) return false

  const wireFormat = Buffer.from(parts[1], 'base64')
  let wOffset = 0
  const typeLen = wireFormat.readUInt32BE(wOffset)
  wOffset += 4 + typeLen
  const keyLen = wireFormat.readUInt32BE(wOffset)
  wOffset += 4
  const rawKey = wireFormat.subarray(wOffset, wOffset + keyLen)
  if (rawKey.length !== 32) return false

  const spkiDer = Buffer.concat([ED25519_SPKI_PREFIX, rawKey])
  const pubKey = createPublicKey({ key: spkiDer, format: 'der', type: 'spki' })

  return verify(null, signedData, pubKey, rawSig.value)
}
