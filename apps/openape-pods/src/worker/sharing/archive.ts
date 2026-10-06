import { crc32, inflateRaw } from 'node:zlib'
import { createHash } from 'node:crypto'
import { canonicalPortableJson, parsePortableManifest, portableFileLimits, portablePath, sharingLimits } from '@openape/pods-protocol'
import { validatePortableFiles } from './package'

interface ZipEntry { path: string, flags: number, method: number, crc: number, compressed: number, expanded: number, offset: number, start: number }
const decoder = new TextDecoder('utf-8', { fatal: true })

function text(bytes: Uint8Array): string {
  try { return decoder.decode(bytes) }
  catch { throw new Error('Portable ZIP text requires valid UTF-8') }
}

function archiveEntries(bytes: Buffer): ZipEntry[] {
  const end = bytes.length - 22
  if (end < 0 || bytes.readUInt32LE(end) !== 0x06054B50 || bytes.readUInt16LE(end + 20) !== 0 || bytes.readUInt16LE(end + 4) !== 0 || bytes.readUInt16LE(end + 6) !== 0) throw new Error('Portable ZIP requires a complete single-volume archive without a comment')
  const count = bytes.readUInt16LE(end + 10); const size = bytes.readUInt32LE(end + 12); const directory = bytes.readUInt32LE(end + 16)
  if (!count || count > sharingLimits.files || bytes.readUInt16LE(end + 8) !== count) throw new Error('Portable ZIP exceeds the 500-file limit or has inconsistent entries')
  if (directory + size !== end) throw new Error('Portable ZIP directory is incomplete or inconsistent')
  const entries: ZipEntry[] = []; const names = new Set<string>(); let cursor = directory; let total = 0
  for (let index = 0; index < count; index++) {
    if (cursor + 46 > end || bytes.readUInt32LE(cursor) !== 0x02014B50) throw new Error('Portable ZIP directory is incomplete or inconsistent')
    const nameBytes = bytes.readUInt16LE(cursor + 28)
    const next = cursor + 46 + nameBytes
    if (!nameBytes || nameBytes > 240 || next > end || bytes.readUInt32LE(cursor + 30) !== 0 || bytes.readUInt16LE(cursor + 34) !== 0) throw new Error('Portable ZIP entry metadata is invalid')
    const path = portablePath(text(bytes.subarray(cursor + 46, cursor + 46 + nameBytes)))
    const flags = bytes.readUInt16LE(cursor + 8); const method = bytes.readUInt16LE(cursor + 10); const attributes = bytes.readUInt32LE(cursor + 38)
    const type = (attributes >>> 16) & 0o170000
    if (names.has(path.toLowerCase())) throw new Error('Portable ZIP contains duplicate normalized paths')
    names.add(path.toLowerCase())
    if (flags !== 0 || ![0, 8].includes(method) || (type !== 0 && type !== 0o100000) || (attributes & 0x10) !== 0) throw new Error('Portable ZIP contains encryption, links or unsupported entries')
    const entry = { path, flags, method, crc: bytes.readUInt32LE(cursor + 16), compressed: bytes.readUInt32LE(cursor + 20), expanded: bytes.readUInt32LE(cursor + 24), offset: bytes.readUInt32LE(cursor + 42), start: 0 }
    total += entry.expanded
    if (total > sharingLimits.expandedBytes || entry.expanded > portableFileLimits.asset || (path === 'manifest.json' && entry.expanded > sharingLimits.manifestBytes)) throw new Error('Portable ZIP exceeds its expanded file or 100 MiB package limit')
    if (method === 0 && entry.compressed !== entry.expanded) throw new Error('Portable ZIP entry metadata is invalid')
    entries.push(entry); cursor = next
  }
  if (cursor !== end) throw new Error('Portable ZIP directory is incomplete or inconsistent')
  let expectedOffset = 0
  for (const entry of [...entries].sort((left, right) => left.offset - right.offset)) {
    const offset = entry.offset
    if (offset !== expectedOffset || offset + 30 > directory || bytes.readUInt32LE(offset) !== 0x04034B50) throw new Error('Portable ZIP local entries overlap or differ from the directory')
    const nameBytes = bytes.readUInt16LE(offset + 26); const extra = bytes.readUInt16LE(offset + 28)
    entry.start = offset + 30 + nameBytes + extra
    if (extra !== 0 || entry.start > directory || text(bytes.subarray(offset + 30, offset + 30 + nameBytes)) !== entry.path || bytes.readUInt16LE(offset + 6) !== entry.flags || bytes.readUInt16LE(offset + 8) !== entry.method) throw new Error('Portable ZIP local entries overlap or differ from the directory')
    for (const [position, expected] of [[14, entry.crc], [18, entry.compressed], [22, entry.expanded]] as const) {
      if (bytes.readUInt32LE(offset + position) !== expected) throw new Error('Portable ZIP local metadata differs from the directory')
    }
    expectedOffset = entry.start + entry.compressed
    if (expectedOffset > directory) throw new Error('Portable ZIP compressed content is incomplete')
  }
  if (expectedOffset !== directory) throw new Error('Portable ZIP contains undeclared local content')
  return entries
}

function inflate(compressed: Buffer, expanded: number): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    // Node ignores bytes after the end of a raw deflate stream; consumed input proves none were hidden.
    inflateRaw(compressed, { info: true, maxOutputLength: Math.max(1, expanded) }, (error, result) => {
      const inflated = result as unknown as { buffer: Buffer, engine: { bytesWritten: number } } | undefined
      if (error || !inflated || inflated.engine.bytesWritten !== compressed.length) reject(new Error('Portable ZIP compressed content is invalid or exceeds its declared size', { cause: error }))
      else resolve(inflated.buffer)
    })
  })
}

async function expand(bytes: Buffer, entry: ZipEntry): Promise<Uint8Array> {
  const compressed = bytes.subarray(entry.start, entry.start + entry.compressed)
  const content = entry.method === 0 ? Uint8Array.from(compressed) : await inflate(compressed, entry.expanded)
  if (content.byteLength !== entry.expanded || crc32(content) !== entry.crc) throw new Error('Portable ZIP entry size or checksum does not match')
  return content
}

export async function readPortableArchive(value: Uint8Array, npmRoot: string, supportedFeatures: readonly string[]) {
  if (!(value instanceof Uint8Array) || value.byteLength > sharingLimits.transferBytes) throw new Error('Portable archive exceeds the 25 MiB transfer limit')
  const bytes = Buffer.from(value)
  const entries = archiveEntries(bytes)
  const manifestEntry = entries.find(entry => entry.path === 'manifest.json')
  if (!manifestEntry) throw new Error('Portable ZIP manifest is missing')
  const manifestText = text(await expand(bytes, manifestEntry))
  const manifest = parsePortableManifest(JSON.parse(manifestText), supportedFeatures)
  if (canonicalPortableJson(manifest) !== manifestText) throw new Error('Portable ZIP manifest is not canonical')
  if (entries.length !== manifest.files.length + 1) throw new Error('Portable file inventory differs from the manifest')
  for (const entry of entries) {
    if (entry === manifestEntry) continue
    const file = manifest.files.find(file => file.path === entry.path)
    if (!file || file.bytes !== entry.expanded) throw new Error('Portable ZIP inventory differs from the declared manifest')
  }
  const files = new Map<string, Uint8Array>()
  for (const entry of entries) {
    if (entry !== manifestEntry) files.set(entry.path, await expand(bytes, entry))
  }
  validatePortableFiles(manifest, files, npmRoot, supportedFeatures)
  return { manifest, files, transferSha256: createHash('sha256').update(bytes).digest('hex') }
}
