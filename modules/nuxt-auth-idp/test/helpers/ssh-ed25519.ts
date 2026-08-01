import type { KeyObject } from 'node:crypto'
import { createHash, generateKeyPairSync, sign } from 'node:crypto'

function wire(data: Buffer | string): Buffer {
  const buf = typeof data === 'string' ? Buffer.from(data) : data
  const len = Buffer.alloc(4)
  len.writeUInt32BE(buf.length)
  return Buffer.concat([len, buf])
}

export interface TestSshKey {
  /** OpenSSH-format public key line, e.g. `ssh-ed25519 AAAA... comment` */
  publicKeySsh: string
  privateKey: KeyObject
  /** Raw ed25519 signature over the given data. */
  sign: (data: string | Buffer) => Buffer
  /** PEM-armored SSHSIG envelope, like `ssh-keygen -Y sign` produces. */
  signSshSig: (message: string, namespace: string) => string
}

export function generateSshEd25519Key(comment = 'test@openape.test'): TestSshKey {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519')
  const jwk = publicKey.export({ format: 'jwk' })
  // ed25519 JWK always carries the raw public key in `x`
  const rawKey = Buffer.from(jwk.x!, 'base64url')
  const keyBlob = Buffer.concat([wire('ssh-ed25519'), wire(rawKey)])
  const publicKeySsh = `ssh-ed25519 ${keyBlob.toString('base64')} ${comment}`

  return {
    publicKeySsh,
    privateKey,
    sign: data => sign(null, typeof data === 'string' ? Buffer.from(data) : data, privateKey),
    signSshSig(message, namespace) {
      const messageHash = createHash('sha512').update(Buffer.from(message)).digest()
      const signedData = Buffer.concat([
        Buffer.from('SSHSIG'),
        wire(namespace),
        wire(''),
        wire('sha512'),
        wire(messageHash),
      ])
      const rawSig = sign(null, signedData, privateKey)
      const sigBlob = Buffer.concat([wire('ssh-ed25519'), wire(rawSig)])
      const version = Buffer.alloc(4)
      version.writeUInt32BE(1)
      const blob = Buffer.concat([
        Buffer.from('SSHSIG'),
        version,
        wire(keyBlob),
        wire(namespace),
        wire(''),
        wire('sha512'),
        wire(sigBlob),
      ])
      const b64 = blob.toString('base64').replace(/(.{70})/g, '$1\n')
      return `-----BEGIN SSH SIGNATURE-----\n${b64}\n-----END SSH SIGNATURE-----`
    },
  }
}
