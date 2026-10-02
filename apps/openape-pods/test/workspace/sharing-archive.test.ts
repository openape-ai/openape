import { crc32, deflateRawSync } from 'node:zlib'
import { canonicalPortableJson, sharingLimits } from '@openape/pods-protocol'
import { expect, it } from 'vitest'
import { readPortableArchive } from '../../src/worker/sharing/archive'
import { createPortablePackage, exportFormatFeatures } from '../../src/worker/sharing/package'
import type { PortableDescription, PortablePayload } from '../../src/worker/sharing/package'

interface RawEntry { name: string, content: Uint8Array, deflate?: boolean, flags?: number, method?: number, attributes?: number, extra?: Uint8Array, localName?: string, crc?: number, expanded?: number, stream?: Uint8Array, offset?: number }
const bytes = (value: string) => new TextEncoder().encode(value)
const regular = (0o100600 << 16) >>> 0

function rawZip(entries: RawEntry[], options: { prefix?: Uint8Array, count?: number } = {}): Uint8Array {
  const locals: Buffer[] = [Buffer.from(options.prefix ?? [])]; const central: Buffer[] = []
  let offset = locals[0]!.length
  for (const entry of entries) {
    const method = entry.method ?? (entry.deflate ? 8 : 0)
    const stream = entry.stream ?? (entry.deflate ? deflateRawSync(entry.content) : entry.content)
    const extra = Buffer.from(entry.extra ?? [])
    const sizes = [entry.crc ?? crc32(entry.content), stream.length, entry.expanded ?? entry.content.length]
    const local = Buffer.alloc(30); local.writeUInt32LE(0x04034B50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(entry.flags ?? 0, 6); local.writeUInt16LE(method, 8)
    local.writeUInt32LE(sizes[0]!, 14); local.writeUInt32LE(sizes[1]!, 18); local.writeUInt32LE(sizes[2]!, 22)
    const localName = Buffer.from(entry.localName ?? entry.name); local.writeUInt16LE(localName.length, 26); local.writeUInt16LE(extra.length, 28)
    locals.push(local, localName, extra, Buffer.from(stream))
    const directory = Buffer.alloc(46); directory.writeUInt32LE(0x02014B50, 0); directory.writeUInt16LE((3 << 8) | 20, 4); directory.writeUInt16LE(20, 6); directory.writeUInt16LE(entry.flags ?? 0, 8); directory.writeUInt16LE(method, 10)
    directory.writeUInt32LE(sizes[0]!, 16); directory.writeUInt32LE(sizes[1]!, 20); directory.writeUInt32LE(sizes[2]!, 24)
    const name = Buffer.from(entry.name); directory.writeUInt16LE(name.length, 28); directory.writeUInt16LE(extra.length, 30)
    directory.writeUInt32LE(entry.attributes ?? regular, 38); directory.writeUInt32LE(entry.offset ?? offset, 42)
    central.push(directory, name, extra)
    offset += 30 + localName.length + extra.length + stream.length
  }
  const directory = Buffer.concat(central); const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054B50, 0); end.writeUInt16LE(options.count ?? entries.length, 8); end.writeUInt16LE(options.count ?? entries.length, 10); end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16)
  return Buffer.concat([...locals, directory, end])
}

async function fixture() {
  const description: PortableDescription = {
    format: 'openape-package', version: 1, package: { key: 'fixture', revision: 1, title: 'Portable fixture', description: '' }, requiredFeatures: ['portable_aliases_v1'],
    entry: { kind: 'pod', key: 'fixture' }, applications: [], compositions: [],
    pods: [{ key: 'fixture', title: 'Fixture', description: '', script: 'pods/fixture.mjs', packages: null, contract: null, requestedCapabilities: [], access: [], inputs: [], bindings: [], applications: [], assets: ['assets/template.txt'] }],
  }
  const payloads: PortablePayload[] = [{ path: 'pods/fixture.mjs', kind: 'script', mediaType: 'text/javascript', content: bytes('export async function run() { return { status: "completed" } }') }, { path: 'assets/template.txt', kind: 'asset', mediaType: 'text/plain', content: bytes('Reusable template '.repeat(20)) }]
  const exported = await createPortablePackage(description, payloads, '')
  const entries = (): RawEntry[] => [{ name: 'manifest.json', content: bytes(canonicalPortableJson(exported.manifest)), deflate: true }, ...payloads.map(file => ({ name: file.path, content: file.content, deflate: file.kind === 'asset' }))]
  return { exported, payloads, entries }
}
const read = (archive: Uint8Array, features: readonly string[] = exportFormatFeatures) => readPortableArchive(archive, '', features)

it('reads exported and equivalent stored or deflated archives', async () => {
  const f = await fixture()
  const result = await read(f.exported.archive)
  expect(result.manifest).toEqual(f.exported.manifest)
  expect(result.transferSha256).toBe(f.exported.transferSha256)
  expect(Object.fromEntries(Array.from(result.files, ([path, content]) => [path, Buffer.from(content).toString()]))).toEqual(Object.fromEntries(f.payloads.map(file => [file.path, Buffer.from(file.content).toString()])))
  expect((await read(rawZip(f.entries()))).manifest).toEqual(f.exported.manifest)
  await expect(read(f.exported.archive, [])).rejects.toThrow('runtime does not support')
})

it('refuses malformed, ambiguous and oversized archives before using their content', async () => {
  const f = await fixture(); const asset = () => f.entries()[2]!
  const change = (index: number, patch: Partial<RawEntry>) => f.entries().map((entry, position) => position === index ? { ...entry, ...patch } : entry)
  const zeros = new Uint8Array(1 << 20)
  const cases: [string, Uint8Array, string][] = [
    ['truncated archive', rawZip(f.entries()).subarray(0, -5), 'complete single-volume'],
    ['trailing bytes', Buffer.concat([rawZip(f.entries()), Buffer.from('extra')]), 'complete single-volume'],
    ['undeclared leading content', rawZip(f.entries(), { prefix: bytes('#!/bin/sh\n') }), 'overlap or differ'],
    ['inconsistent entry count', rawZip(f.entries(), { count: 2 }), 'directory is incomplete'],
    ['file limit', rawZip(f.entries(), { count: sharingLimits.files + 1 }), '500-file limit'],
    ['parent traversal', rawZip(change(2, { name: '../escape.txt' })), 'unsupported file path'],
    ['absolute path', rawZip(change(2, { name: '/etc/passwd' })), 'relative and normalized'],
    ['backslash path', rawZip(change(2, { name: 'assets\\template.txt' })), 'relative and normalized'],
    ['directory entry', rawZip(change(2, { name: 'assets/' })), 'relative and normalized'],
    ['case-variant duplicate', rawZip([...f.entries(), { ...asset(), name: 'assets/Template.txt' }]), 'duplicate normalized paths'],
    ['symbolic link', rawZip(change(2, { attributes: (0o120777 << 16) >>> 0 })), 'encryption, links or unsupported'],
    ['directory attribute', rawZip(change(2, { attributes: (regular | 0x10) >>> 0 })), 'encryption, links or unsupported'],
    ['encrypted entry', rawZip(change(2, { flags: 1 })), 'encryption, links or unsupported'],
    ['data descriptor', rawZip(change(2, { flags: 8 })), 'encryption, links or unsupported'],
    ['unsupported compression', rawZip(change(2, { method: 12 })), 'encryption, links or unsupported'],
    ['extension field', rawZip(change(2, { extra: Buffer.from([1, 0, 4, 0, 0, 0, 0, 0]) })), 'metadata is invalid'],
    ['unneeded name encoding flag', rawZip(change(2, { flags: 0x800 })), 'encryption, links or unsupported'],
    ['different local name', rawZip(change(2, { localName: 'assets/templatE.txt' })), 'overlap or differ'],
    ['shared local entry', rawZip(change(2, { offset: 0 })), 'overlap or differ'],
    ['stored size mismatch', rawZip(change(1, { expanded: 3 })), 'metadata is invalid'],
    ['expansion beyond declared size', rawZip(change(2, { stream: deflateRawSync(zeros) })), 'exceeds its declared size'],
    ['declared size above the file limit', rawZip(change(2, { expanded: 33 * 1024 * 1024 })), 'expanded file or 100 MiB'],
    ['oversized manifest', rawZip(change(0, { content: zeros, expanded: sharingLimits.manifestBytes + 1 })), 'expanded file or 100 MiB'],
    ['hidden bytes after the compressed stream', rawZip(change(2, { stream: Buffer.concat([deflateRawSync(asset().content), bytes('hidden')]) })), 'invalid or exceeds'],
    ['truncated compressed stream', rawZip(change(2, { stream: deflateRawSync(asset().content).subarray(0, -3) })), 'invalid or exceeds'],
    ['wrong checksum', rawZip(change(2, { crc: 1 })), 'size or checksum'],
    ['changed bytes with a valid checksum', rawZip(change(1, { content: bytes('export async function run() { return { status: "tampered!" } }') })), 'bytes differ from the reviewed manifest'],
    ['missing manifest', rawZip(f.entries().slice(1)), 'manifest is missing'],
    ['undeclared file', rawZip([...f.entries(), { name: 'assets/extra.txt', content: bytes('extra') }]), 'inventory differs'],
    ['missing declared file', rawZip(f.entries().slice(0, 2)), 'inventory differs'],
    ['non-canonical manifest', rawZip(change(0, { content: bytes(JSON.stringify(f.exported.manifest, null, 1)) })), 'not canonical'],
    ['invalid text', rawZip(change(0, { content: Buffer.from([0xFF, 0xFE]) })), 'valid UTF-8'],
  ]
  for (const [name, archive, message] of cases) await expect(read(archive), name).rejects.toThrow(message)
  await expect(read(new Uint8Array(sharingLimits.transferBytes + 1))).rejects.toThrow('25 MiB transfer limit')
})
