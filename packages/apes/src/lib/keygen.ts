import { Buffer } from 'node:buffer'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { generateKeyPairSync } from 'node:crypto'
import { homedir } from 'node:os'
import { dirname, resolve } from 'node:path'
import { loadEd25519PrivateKey } from '../ssh-key'

export function resolveKeyPath(p: string): string {
  return resolve(p.replace(/^~/, homedir()))
}

function buildSshEd25519Line(rawPub: Buffer): string {
  const keyTypeStr = 'ssh-ed25519'
  const keyTypeLen = Buffer.alloc(4)
  keyTypeLen.writeUInt32BE(keyTypeStr.length)
  const pubKeyLen = Buffer.alloc(4)
  pubKeyLen.writeUInt32BE(rawPub.length)
  const blob = Buffer.concat([keyTypeLen, Buffer.from(keyTypeStr), pubKeyLen, rawPub])
  return `ssh-ed25519 ${blob.toString('base64')}`
}

export function readPublicKey(keyPath: string): string {
  const pubPath = `${keyPath}.pub`
  if (existsSync(pubPath)) {
    return readFileSync(pubPath, 'utf-8').trim()
  }

  const keyContent = readFileSync(keyPath, 'utf-8')
  const privateKey = loadEd25519PrivateKey(keyContent)
  const jwk = privateKey.export({ format: 'jwk' }) as { x: string }
  const pubBytes = Buffer.from(jwk.x, 'base64url')
  return buildSshEd25519Line(pubBytes)
}

export function generateAndSaveKey(keyPath: string): string {
  const resolved = resolveKeyPath(keyPath)
  const dir = dirname(resolved)

  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }

  const { publicKey, privateKey } = generateKeyPairSync('ed25519')

  const privatePem = privateKey.export({ type: 'pkcs8', format: 'pem' }) as string
  writeFileSync(resolved, privatePem, { mode: 0o600 })

  const jwk = publicKey.export({ format: 'jwk' }) as { x: string }
  const pubBytes = Buffer.from(jwk.x, 'base64url')
  const pubKeyStr = buildSshEd25519Line(pubBytes)

  writeFileSync(`${resolved}.pub`, `${pubKeyStr}\n`, { mode: 0o644 })

  return pubKeyStr
}

export interface GeneratedKeyPair {
  privatePem: string
  publicSshLine: string
}

export function generateKeyPairInMemory(): GeneratedKeyPair {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519')
  const privatePem = privateKey.export({ type: 'pkcs8', format: 'pem' }) as string
  const jwk = publicKey.export({ format: 'jwk' }) as { x: string }
  const pubBytes = Buffer.from(jwk.x, 'base64url')
  return {
    privatePem,
    publicSshLine: buildSshEd25519Line(pubBytes),
  }
}
