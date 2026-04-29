import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import forge from 'node-forge'

export interface LoadOrCreateCaOpts {
  certPath: string
  keyPath: string
  subjectCN: string
}

export interface CaBundle {
  certPem: string
  keyPem: string
  created: boolean
}

export function loadOrCreateCa(opts: LoadOrCreateCaOpts): CaBundle {
  if (existsSync(opts.certPath) && existsSync(opts.keyPath)) {
    return {
      certPem: readFileSync(opts.certPath, 'utf-8'),
      keyPem: readFileSync(opts.keyPath, 'utf-8'),
      created: false,
    }
  }

  const keys = forge.pki.rsa.generateKeyPair({ bits: 2048 })
  const cert = forge.pki.createCertificate()
  cert.publicKey = keys.publicKey
  cert.serialNumber = String(Date.now())
  cert.validity.notBefore = new Date()
  cert.validity.notAfter = new Date(Date.now() + 10 * 365 * 86400_000)
  const attrs = [{ name: 'commonName', value: opts.subjectCN }]
  cert.setSubject(attrs)
  cert.setIssuer(attrs)
  cert.setExtensions([
    { name: 'basicConstraints', cA: true },
    { name: 'keyUsage', keyCertSign: true, cRLSign: true },
    { name: 'subjectKeyIdentifier' },
  ])
  cert.sign(keys.privateKey, forge.md.sha256.create())

  const certPem = forge.pki.certificateToPem(cert)
  const keyPem = forge.pki.privateKeyToPem(keys.privateKey)

  mkdirSync(dirname(opts.certPath), { recursive: true, mode: 0o700 })
  writeFileSync(opts.certPath, certPem, { mode: 0o600 })
  writeFileSync(opts.keyPath, keyPem, { mode: 0o600 })

  return { certPem, keyPem, created: true }
}
