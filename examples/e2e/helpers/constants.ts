import type { KeyObject } from 'node:crypto'
import { generateKeyPairSync } from 'node:crypto'

/** When E2E_IDP_URL is set, tests run against deployed (prod) servers. */
export const IS_PROD = !!process.env.E2E_IDP_URL

export const IDP_PORT = 3000
export const SP_PORT = 3001

export const IDP_URL = process.env.E2E_IDP_URL || `http://localhost:${IDP_PORT}`
export const SP_URL = process.env.E2E_SP_URL || `http://localhost:${SP_PORT}`

export const MANAGEMENT_TOKEN = process.env.E2E_MANAGEMENT_TOKEN || 'test-mgmt-token'

export const SP_ID = process.env.E2E_SP_ID || 'sp.example.com'

/** Test user — domain must match the DDISA DNS record for the target environment. */
export const TEST_USER = {
  email: process.env.E2E_TEST_EMAIL || 'admin@example.com',
  password: process.env.E2E_TEST_PASSWORD || 'q1w2e3r4',
  name: 'E2E Test User',
}

// --- SSH key auth test keypair ---

const { publicKey: testPublicKeyObject, privateKey: testPrivateKeyObject } = generateKeyPairSync('ed25519')

export const TEST_SSH_PRIVATE_KEY = testPrivateKeyObject
export const TEST_SSH_PUBLIC_KEY_OBJECT = testPublicKeyObject

/** Format an ed25519 public key as an OpenSSH string (ssh-ed25519 ...). */
function keyObjectToSshString(pubKey: KeyObject, email: string): string {
  const rawKey = pubKey.export({ type: 'spki', format: 'der' })
  // SPKI DER for ed25519 is 44 bytes: 12 byte prefix + 32 byte key
  const raw32 = (rawKey as Buffer).subarray(12)

  // Build SSH wire format: uint32(len("ssh-ed25519")) + "ssh-ed25519" + uint32(32) + raw_key
  const typeStr = 'ssh-ed25519'
  const typeBuf = Buffer.from(typeStr)
  const wire = Buffer.alloc(4 + typeBuf.length + 4 + 32)
  wire.writeUInt32BE(typeBuf.length, 0)
  typeBuf.copy(wire, 4)
  wire.writeUInt32BE(32, 4 + typeBuf.length)
  raw32.copy(wire, 4 + typeBuf.length + 4)

  return `ssh-ed25519 ${wire.toString('base64')} ${email}`
}

export const TEST_SSH_PUBLIC_KEY = keyObjectToSshString(testPublicKeyObject, TEST_USER.email)
