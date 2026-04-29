import { describe, expect, it } from 'vitest'
import { existsSync, mkdtempSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import forge from 'node-forge'
import { createLeafCertCache, loadOrCreateCa, mintLeafCert } from '../src/ca-store.js'

describe('loadOrCreateCa — load existing', () => {
  it('loads an existing CA from disk if both files are present', () => {
    const dir = mkdtempSync(join(tmpdir(), 'castore-'))
    // Pre-seed a known cert+key (use any valid PEM pair you have for the test;
    // for now we generate one inline using node-forge):
    const keys = forge.pki.rsa.generateKeyPair({ bits: 2048 })
    const cert = forge.pki.createCertificate()
    cert.publicKey = keys.publicKey
    cert.serialNumber = '01'
    cert.validity.notBefore = new Date()
    cert.validity.notAfter = new Date(Date.now() + 86400_000)
    cert.setSubject([{ name: 'commonName', value: 'TestCA' }])
    cert.setIssuer([{ name: 'commonName', value: 'TestCA' }])
    cert.sign(keys.privateKey, forge.md.sha256.create())
    const certPath = join(dir, 'ca.crt')
    const keyPath = join(dir, 'ca.key')
    writeFileSync(certPath, forge.pki.certificateToPem(cert), { mode: 0o600 })
    writeFileSync(keyPath, forge.pki.privateKeyToPem(keys.privateKey), { mode: 0o600 })

    const ca = loadOrCreateCa({ certPath, keyPath, subjectCN: 'unused-on-load' })
    expect(ca.certPem).toContain('BEGIN CERTIFICATE')
    expect(ca.keyPem).toContain('BEGIN RSA PRIVATE KEY')
    expect(ca.created).toBe(false)
  })
})

describe('loadOrCreateCa — generate', () => {
  it('generates a fresh CA when files do not exist', () => {
    const dir = mkdtempSync(join(tmpdir(), 'castore-gen-'))
    const certPath = join(dir, 'ca.crt')
    const keyPath = join(dir, 'ca.key')

    const ca = loadOrCreateCa({ certPath, keyPath, subjectCN: 'OpenApe Proxy CA (test)' })
    expect(ca.created).toBe(true)
    expect(ca.certPem).toContain('BEGIN CERTIFICATE')
    expect(ca.keyPem).toMatch(/BEGIN (RSA )?PRIVATE KEY/)
    expect(existsSync(certPath)).toBe(true)
    expect(existsSync(keyPath)).toBe(true)
    expect(statSync(certPath).mode & 0o777).toBe(0o600)
    expect(statSync(keyPath).mode & 0o777).toBe(0o600)
  })

  it('reads back an exact match after generation', () => {
    const dir = mkdtempSync(join(tmpdir(), 'castore-roundtrip-'))
    const certPath = join(dir, 'ca.crt')
    const keyPath = join(dir, 'ca.key')

    const first = loadOrCreateCa({ certPath, keyPath, subjectCN: 'OpenApe Proxy CA (test)' })
    const second = loadOrCreateCa({ certPath, keyPath, subjectCN: 'ignored' })
    expect(second.created).toBe(false)
    expect(second.certPem).toBe(first.certPem)
    expect(second.keyPem).toBe(first.keyPem)
  })
})

describe('mintLeafCert', () => {
  it('mints a leaf cert chained to the local CA', () => {
    const dir = mkdtempSync(join(tmpdir(), 'castore-leaf-'))
    const ca = loadOrCreateCa({
      certPath: join(dir, 'ca.crt'),
      keyPath: join(dir, 'ca.key'),
      subjectCN: 'OpenApe Proxy CA (test)',
    })

    const leaf = mintLeafCert(ca, 'api.github.com')
    expect(leaf.certPem).toContain('BEGIN CERTIFICATE')
    expect(leaf.keyPem).toMatch(/BEGIN (RSA )?PRIVATE KEY/)

    // Verify SAN includes the hostname.
    const parsed = forge.pki.certificateFromPem(leaf.certPem)
    const sanExt = parsed.extensions.find((e: any) => e.name === 'subjectAltName')
    expect(sanExt).toBeTruthy()
    const altNames = (sanExt as any).altNames as { type: number, value: string }[]
    expect(altNames.some(n => n.type === 2 && n.value === 'api.github.com')).toBe(true)

    // Verify it's signed by the CA.
    const caStore = forge.pki.createCaStore([ca.certPem])
    expect(() => forge.pki.verifyCertificateChain(caStore, [parsed])).not.toThrow()
  })
})

describe('createLeafCertCache', () => {
  it('returns the same cert for repeated calls (cache hit)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cache-'))
    const ca = loadOrCreateCa({
      certPath: join(dir, 'ca.crt'),
      keyPath: join(dir, 'ca.key'),
      subjectCN: 'CA',
    })
    const cache = createLeafCertCache(ca, { capacity: 4 })
    const a = cache.get('api.github.com')
    const b = cache.get('api.github.com')
    expect(a.certPem).toBe(b.certPem)
  })

  it('evicts least-recently-used when over capacity', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cache-'))
    const ca = loadOrCreateCa({
      certPath: join(dir, 'ca.crt'),
      keyPath: join(dir, 'ca.key'),
      subjectCN: 'CA',
    })
    const cache = createLeafCertCache(ca, { capacity: 2 })
    const a1 = cache.get('a.example.com')
    cache.get('b.example.com')
    cache.get('c.example.com')  // evicts 'a'
    const a2 = cache.get('a.example.com')
    expect(a1.certPem).not.toBe(a2.certPem)  // re-minted
  })
})
