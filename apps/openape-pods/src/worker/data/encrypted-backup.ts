import { createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes, randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import { lstat, mkdir, open, readdir, realpath, rename, rm } from 'node:fs/promises'
import type { FileHandle } from 'node:fs/promises'
import { dirname, join, sep } from 'node:path'
import type { PodDatabase } from '../storage/database'
import { createBackup, parseBackupManifest, restoreBackup } from './backup'
import { durableJSON, privateTarget, relativePath, syncDirectory, syncTree } from './files'
import type { FileRecord } from './files'

export interface BackupEncryption { keyId: string, key: Uint8Array }
interface SealedFile { path: string, id: string, nonce: string, tag: string }
const fileLimit = 256 * 1024 * 1024
const manifestLimit = 32 * 1024 * 1024
const format = 'openape-pods-encrypted-backup'

function encryptionKey(value: BackupEncryption): Buffer {
  if (!/^[\w-]{1,100}$/.test(value.keyId) || !(value.key instanceof Uint8Array) || value.key.byteLength !== 32) throw new Error('A protected 256-bit backup key and key reference are required')
  return Buffer.from(value.key)
}
function associated(keyId: string, id: string): Buffer { return Buffer.from(JSON.stringify([format, 1, keyId, id])) }
function encoded(value: unknown, bytes: number): Buffer {
  if (typeof value !== 'string' || !/^[a-f0-9]+$/.test(value) || value.length !== bytes * 2) throw new Error('Invalid encrypted backup encoding')
  return Buffer.from(value, 'hex')
}
async function inputFile(root: string, path: string, limit: number) {
  relativePath(path)
  const source = join(root, path)
  if (await realpath(source) !== source) throw new Error('Encrypted backup contains an escaped file')
  const file = await open(source, constants.O_RDONLY | constants.O_NOFOLLOW)
  try {
    const info = await file.stat()
    if (!info.isFile() || info.nlink !== 1 || info.size > limit) throw new Error('Unsupported encrypted backup file')
    return file
  }
  catch (error) { await file.close(); throw error }
}
async function sealFile(sourceRoot: string, source: FileRecord, stage: string, key: Buffer, keyId: string): Promise<SealedFile> {
  const id = randomUUID(); const nonce = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, nonce); cipher.setAAD(associated(keyId, id))
  const input = await inputFile(sourceRoot, source.path, fileLimit)
  try {
    const before = await input.stat({ bigint: true })
    const output = await open(join(stage, 'files', id), 'wx', 0o600)
    try {
      const hash = createHash('sha256'); const buffer = Buffer.alloc(1024 * 1024); let size = 0
      for (;;) {
        const next = await input.read(buffer, 0, buffer.length, null); if (!next.bytesRead) break
        const bytes = buffer.subarray(0, next.bytesRead); size += bytes.length
        if (size > fileLimit) throw new Error('Backup file grew beyond its limit')
        hash.update(bytes); await output.writeFile(cipher.update(bytes))
      }
      const after = await input.stat({ bigint: true })
      if (size !== source.size || hash.digest('hex') !== source.hash || before.mtimeNs !== after.mtimeNs || before.ctimeNs !== after.ctimeNs) throw new Error('Backup changed during encryption')
      await output.writeFile(cipher.final()); await output.sync()
      return { path: source.path, id, nonce: nonce.toString('hex'), tag: cipher.getAuthTag().toString('hex') }
    }
    finally { await output.close() }
  }
  finally { await input.close() }
}

export async function createEncryptedBackup(store: PodDatabase, parent: string, encryption: BackupEncryption): Promise<string> {
  const masterKey = encryptionKey(encryption); const salt = randomBytes(32)
  const key = Buffer.from(hkdfSync('sha256', masterKey, salt, associated(encryption.keyId, 'archive-key'), 32)); masterKey.fill(0)
  let plaintextRoot: string | undefined; let stage: string | undefined
  try {
    const canonical = await realpath(parent)
    const localStaging = await encryptedBackupStaging(store.root)
    if (canonical === localStaging || canonical.startsWith(localStaging + sep)) throw new Error('Choose a backup destination outside local plaintext staging')
    plaintextRoot = await privateTarget(localStaging, `.seal-source-${randomUUID()}`)
    stage = await privateTarget(canonical, `.seal-output-${randomUUID()}`)
    const target = join(canonical, `OpenApe-Pods-encrypted-${randomUUID()}`)
    const source = await createBackup(store, plaintextRoot)
    const manifest = parseBackupManifest(JSON.parse(await readBounded(source, 'backup.json', manifestLimit)))
    await mkdir(join(stage, 'files'), { mode: 0o700 })
    const files: SealedFile[] = []
    for (const file of manifest.files) files.push(await sealFile(source, file, stage, key, encryption.keyId))
    const nonce = randomBytes(12); const cipher = createCipheriv('aes-256-gcm', key, nonce)
    cipher.setAAD(associated(encryption.keyId, 'manifest'))
    const body = Buffer.from(JSON.stringify({ manifest, files }))
    if (body.length > manifestLimit) throw new Error('Encrypted backup manifest exceeds its limit')
    const ciphertext = Buffer.concat([cipher.update(body), cipher.final()])
    const file = await open(join(stage, 'manifest.enc'), 'wx', 0o600)
    try { await file.writeFile(ciphertext); await file.sync() }
    finally { await file.close() }
    await durableJSON(join(stage, 'backup.encrypted.json'), { format, version: 1, keyId: encryption.keyId, salt: salt.toString('hex'), nonce: nonce.toString('hex'), tag: cipher.getAuthTag().toString('hex') })
    await syncTree(stage)
    await rm(plaintextRoot, { recursive: true, force: true }); plaintextRoot = undefined
    await rename(stage, target); stage = undefined; await syncDirectory(canonical)
    return target
  }
  finally {
    key.fill(0)
    await Promise.all([...(stage ? [rm(stage, { recursive: true, force: true })] : []), ...(plaintextRoot ? [rm(plaintextRoot, { recursive: true, force: true })] : [])])
  }
}

async function decryptFile(sourceRoot: string, sealed: SealedFile, expected: FileRecord, stage: string, key: Buffer, keyId: string): Promise<void> {
  const input = await inputFile(sourceRoot, `files/${sealed.id}`, fileLimit)
  try {
    const destination = join(stage, relativePath(expected.path)); await mkdir(dirname(destination), { recursive: true, mode: 0o700 })
    const output = await open(destination, 'wx', 0o600)
    try {
      const decipher = createDecipheriv('aes-256-gcm', key, encoded(sealed.nonce, 12)); decipher.setAAD(associated(keyId, sealed.id)); decipher.setAuthTag(encoded(sealed.tag, 16))
      const hash = createHash('sha256'); const buffer = Buffer.alloc(1024 * 1024); let size = 0
      for (;;) {
        const next = await input.read(buffer, 0, buffer.length, null); if (!next.bytesRead) break
        size += next.bytesRead; if (size > expected.size) throw new Error('Encrypted backup file exceeds declared size')
        const bytes = decipher.update(buffer.subarray(0, next.bytesRead)); hash.update(bytes); await output.writeFile(bytes)
      }
      const final = decipher.final(); hash.update(final); await output.writeFile(final)
      if (size !== expected.size || hash.digest('hex') !== expected.hash) throw new Error('Encrypted backup checksum mismatch')
      await output.sync()
    }
    finally { await output.close() }
  }
  finally { await input.close() }
}

export async function restoreEncryptedBackup(backup: string, parent: string, maximumSchema: number, encryption: BackupEncryption, localProfileRoot: string): Promise<string> {
  let key = encryptionKey(encryption); let stage: string | undefined
  try {
    const source = await realpath(backup); const canonical = await realpath(parent)
    if (canonical === source || canonical.startsWith(source + sep)) throw new Error('Choose a restore destination outside the encrypted backup')
    const header = object(JSON.parse(await readBounded(source, 'backup.encrypted.json', 1024)))
    if (header.format !== format || header.version !== 1 || header.keyId !== encryption.keyId || Object.keys(header).some(key => !['format', 'version', 'keyId', 'salt', 'nonce', 'tag'].includes(key))) throw new Error('Unsupported encrypted backup header or key reference')
    const derived = Buffer.from(hkdfSync('sha256', key, encoded(header.salt, 32), associated(encryption.keyId, 'archive-key'), 32)); key.fill(0); key = derived
    const manifestFile = await inputFile(source, 'manifest.enc', manifestLimit)
    let payload: Record<string, unknown>
    try {
      const decipher = createDecipheriv('aes-256-gcm', key, encoded(header.nonce, 12)); decipher.setAAD(associated(encryption.keyId, 'manifest')); decipher.setAuthTag(encoded(header.tag, 16))
      payload = object(JSON.parse(Buffer.concat([decipher.update(await boundedBytes(manifestFile, manifestLimit)), decipher.final()]).toString('utf8')))
    }
    finally { await manifestFile.close() }
    const manifest = parseBackupManifest(payload.manifest)
    if (manifest.schema > maximumSchema) throw new Error('This encrypted backup needs a newer application')
    if (!Array.isArray(payload.files) || payload.files.length !== manifest.files.length) throw new Error('Invalid encrypted backup inventory')
    const expected = new Map(manifest.files.map(file => [file.path, file]))
    const seen = new Set<string>(); const ids = new Set<string>()
    const files = payload.files as SealedFile[]
    for (const sealed of files) {
      if (!sealed || typeof sealed !== 'object' || Object.keys(sealed).some(key => !['path', 'id', 'nonce', 'tag'].includes(key)) || typeof sealed.id !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(sealed.id) || seen.has(sealed.path) || ids.has(sealed.id) || !expected.has(sealed.path)) throw new Error('Invalid encrypted backup file binding')
      seen.add(sealed.path); ids.add(sealed.id); encoded(sealed.nonce, 12); encoded(sealed.tag, 16)
    }
    const localStaging = await encryptedBackupStaging(localProfileRoot)
    if (canonical === localStaging || canonical.startsWith(localStaging + sep)) throw new Error('Choose a restore destination outside local plaintext staging')
    stage = await privateTarget(localStaging, `.unseal-${randomUUID()}`)
    for (const sealed of files) await decryptFile(source, sealed, expected.get(sealed.path)!, stage, key, encryption.keyId)
    await durableJSON(join(stage, 'backup.json'), manifest)
    return await restoreBackup(stage, canonical, maximumSchema)
  }
  finally { key.fill(0); if (stage) await rm(stage, { recursive: true, force: true }) }
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid encrypted backup object')
  return value as Record<string, unknown>
}
async function readBounded(root: string, path: string, limit: number): Promise<string> {
  const file = await inputFile(root, path, limit)
  try { return (await boundedBytes(file, limit)).toString('utf8') }
  finally { await file.close() }
}
async function boundedBytes(file: FileHandle, limit: number): Promise<Buffer> {
  const parts: Buffer[] = []; let size = 0
  for (;;) {
    const buffer = Buffer.alloc(Math.min(1024 * 1024, limit - size + 1))
    const next = await file.read(buffer, 0, buffer.length, null)
    if (!next.bytesRead) return Buffer.concat(parts, size)
    size += next.bytesRead
    if (size > limit) throw new Error('Encrypted backup file grew beyond its limit')
    parts.push(buffer.subarray(0, next.bytesRead))
  }
}

async function stagingPath(localProfileRoot: string): Promise<string> {
  const profile = await realpath(localProfileRoot)
  return join(dirname(profile), `OpenApe-Pods-backup-staging-${createHash('sha256').update(profile).digest('hex').slice(0, 16)}`)
}
async function assertPrivateStaging(staging: string): Promise<void> {
  const info = await lstat(staging)
  if (!info.isDirectory() || info.isSymbolicLink() || (info.mode & 0o077) !== 0 || (process.getuid && info.uid !== process.getuid())) throw new Error('Encrypted backup staging requires a private local application directory')
}
export async function encryptedBackupStaging(localProfileRoot: string): Promise<string> {
  const staging = await stagingPath(localProfileRoot)
  try { await mkdir(staging, { mode: 0o700 }) }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error }
  await assertPrivateStaging(staging)
  return staging
}

export async function cleanupEncryptedBackupStaging(localProfileRoot: string): Promise<void> {
  const staging = await stagingPath(localProfileRoot)
  try { await assertPrivateStaging(staging) }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error }
  let unsupported = false
  for (const name of await readdir(staging)) {
    const path = join(staging, name); const info = await lstat(path)
    if (name === '.DS_Store' && info.isFile()) continue
    if (!/^\.(?:seal-source|unseal)-[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(name) || !info.isDirectory() || info.isSymbolicLink()) { unsupported = true; continue }
    await rm(path, { recursive: true, force: true })
  }
  await syncDirectory(staging)
  if (unsupported) throw new Error('Unsupported encrypted backup staging entry')
}
