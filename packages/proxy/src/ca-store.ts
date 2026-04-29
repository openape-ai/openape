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
  // Tag the CN explicitly as UTF8String. node-forge defaults to PrintableString
  // for ASCII inputs, but its DER serializer can emit byte sequences that Go's
  // strict crypto/x509 parser flags ("invalid PrintableString"). UTF8String
  // sidesteps the strict-mode check and is universally accepted.
  // valueTagClass takes an asn1.Type value (the upstream @types annotation says
  // asn1.Class but node-forge's x509.js reads it from asn1.Type at runtime).
  const attrs = [
    { name: 'commonName', value: opts.subjectCN, valueTagClass: forge.asn1.Type.UTF8 },
  ]
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

export interface LeafCert {
  certPem: string
  keyPem: string
  expiresAt: number
}

export function mintLeafCert(ca: CaBundle, hostname: string): LeafCert {
  const caCert = forge.pki.certificateFromPem(ca.certPem)
  const caKey = forge.pki.privateKeyFromPem(ca.keyPem)

  const keys = forge.pki.rsa.generateKeyPair({ bits: 2048 })
  const cert = forge.pki.createCertificate()
  cert.publicKey = keys.publicKey
  cert.serialNumber = `${Date.now()}${Math.floor(Math.random() * 1e6)}`
  cert.validity.notBefore = new Date()
  const expiresAt = Date.now() + 24 * 3600_000
  cert.validity.notAfter = new Date(expiresAt)
  // Tag CN as UTF8String for the same reason as the CA — keeps Go's strict
  // crypto/x509 parser happy. The issuer attributes come straight from the
  // parsed CA, which is already UTF8-tagged.
  cert.setSubject([
    { name: 'commonName', value: hostname, valueTagClass: forge.asn1.Type.UTF8 },
  ])
  cert.setIssuer(caCert.subject.attributes)
  cert.setExtensions([
    { name: 'basicConstraints', cA: false },
    { name: 'keyUsage', digitalSignature: true, keyEncipherment: true },
    { name: 'extKeyUsage', serverAuth: true },
    { name: 'subjectAltName', altNames: [{ type: 2, value: hostname }] },
  ])
  cert.sign(caKey, forge.md.sha256.create())

  return {
    certPem: forge.pki.certificateToPem(cert),
    keyPem: forge.pki.privateKeyToPem(keys.privateKey),
    expiresAt,
  }
}

export interface LeafCertCache {
  get: (hostname: string) => LeafCert
}

export function createLeafCertCache(ca: CaBundle, opts: { capacity: number }): LeafCertCache {
  const cache = new Map<string, LeafCert>()
  return {
    get(hostname) {
      const existing = cache.get(hostname)
      if (existing && existing.expiresAt > Date.now()) {
        cache.delete(hostname)
        cache.set(hostname, existing)  // refresh LRU position
        return existing
      }
      const fresh = mintLeafCert(ca, hostname)
      cache.set(hostname, fresh)
      while (cache.size > opts.capacity) {
        const oldestKey = cache.keys().next().value
        if (oldestKey === undefined) break
        cache.delete(oldestKey)
      }
      return fresh
    },
  }
}
