import { describe, expect, it } from 'vitest'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import forge from 'node-forge'
import { loadOrCreateCa } from '../src/ca-store.js'

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
