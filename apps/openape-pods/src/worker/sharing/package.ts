import { createHash } from 'node:crypto'
import { zip } from 'fflate'
import type { Zippable } from 'fflate'
import { canonicalPortableJson, parsePortableManifest, portableContentBytes, portableFileLimits, sharingLimits } from '@openape/pods-protocol'
import type { PortableFile, PortableManifest } from '@openape/pods-protocol'
import { parsePackages } from '../../contracts/dependencies'
import { validatePortableAccessDefaults, validatePortableCollectionDocument, validatePortableCompositionDocument } from '../../contracts/portable-composition'
import { parseImportedLock } from '../dependencies/imported-lock'

export const exportFormatFeatures = ['portable_aliases_v1'] as const
export interface PortablePayload { path: string, kind: PortableFile['kind'], mediaType: string, content: Uint8Array }
export interface PortablePackage { manifest: PortableManifest, archive: Uint8Array, transferSha256: string }
export type PortableDescription = Omit<PortableManifest, 'files' | 'contentSha256'>
const sha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex')
const decoder = new TextDecoder('utf-8', { fatal: true })

function textFile(content: Uint8Array): string {
  try { return decoder.decode(content) }
  catch { throw new Error('Portable text files require valid UTF-8') }
}
export function assertPortableAsset(path: string, content: Uint8Array): void {
  const magic = Buffer.from(content.subarray(0, 4)).toString('hex')
  if (/\.(?:js|mjs|cjs|jsx|ts|tsx|mts|cts|vbs|scr|lnk|tool|terminal|workflow|sh|bash|zsh|command|bat|cmd|ps1|py|rb|node|dylib|so|dll|exe|wasm|app|jar|class|scpt|scptd|pkg|dmg|msi|com)$/i.test(path) || ['7f454c46', 'cffaedfe', 'feedfacf', 'feedface', 'cafebabe', 'bebafeca', 'cafebabf', 'bfbafeca', 'cefaedfe', '0061736d'].includes(magic) || magic.startsWith('4d5a') || magic.startsWith('2321')) throw new Error('Portable assets cannot contain executable payloads')
}

export function validatePortableFiles(value: unknown, files: ReadonlyMap<string, Uint8Array>, npmRoot: string, supportedFeatures: readonly string[]): PortableManifest {
  const manifest = parsePortableManifest(value, supportedFeatures)
  if (files.size !== manifest.files.length) throw new Error('Portable file inventory differs from the manifest')
  if (sha256(portableContentBytes(manifest, supportedFeatures)) !== manifest.contentSha256) throw new Error('Portable manifest content digest does not match')
  for (const file of manifest.files) {
    const content = files.get(file.path)
    if (!content || content.byteLength !== file.bytes || sha256(content) !== file.sha256) throw new Error('Portable file bytes differ from the reviewed manifest')
    if (file.kind === 'asset') assertPortableAsset(file.path, content)
    if (file.kind === 'script' && textFile(content).length > 200000) throw new Error('Portable script exceeds the native character limit')
    if (file.kind === 'data-schema') validatePortableCollectionDocument(JSON.parse(textFile(content)))
  }
  for (const pod of manifest.pods) {
    validatePortableAccessDefaults(pod)
    if (pod.packages) {
      const packages = parsePackages(JSON.parse(textFile(files.get(pod.packages.manifest)!)))
      parseImportedLock(textFile(files.get(pod.packages.lock)!), packages, npmRoot)
    }
  }
  for (const composition of manifest.compositions) validatePortableCompositionDocument(JSON.parse(textFile(files.get(composition.document)!)), composition, manifest)
  return manifest
}

export async function createPortablePackage(description: PortableDescription, payloads: readonly PortablePayload[], npmRoot: string): Promise<PortablePackage> {
  if (payloads.length >= sharingLimits.files) throw new Error('Portable package contains too many files')
  let expandedBytes = 0
  const files = new Map<string, Uint8Array>(); const inventory: PortableFile[] = []
  for (const payload of payloads) {
    if (files.has(payload.path)) throw new Error('Portable package contains duplicate file paths')
    expandedBytes += payload.content.byteLength
    if (expandedBytes > sharingLimits.expandedBytes || payload.content.byteLength > portableFileLimits[payload.kind]) throw new Error('Portable payload exceeds its size limit')
    const content = Uint8Array.from(payload.content)
    files.set(payload.path, content)
    inventory.push({ path: payload.path, kind: payload.kind, mediaType: payload.mediaType, bytes: content.byteLength, sha256: sha256(content) })
  }
  inventory.sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0)
  const candidate = parsePortableManifest({ ...description, files: inventory, contentSha256: '0'.repeat(64) }, exportFormatFeatures)
  candidate.contentSha256 = sha256(portableContentBytes(candidate, exportFormatFeatures))
  const manifest = validatePortableFiles(candidate, files, npmRoot, exportFormatFeatures)
  const archiveFiles: Zippable = Object.fromEntries([
    ['manifest.json', new TextEncoder().encode(canonicalPortableJson(manifest))],
    ...inventory.map(file => [file.path, files.get(file.path)!]),
  ])
  const archive = await new Promise<Uint8Array>((resolve, reject) => {
    zip(archiveFiles, { level: 1, mtime: new Date(1980, 0, 1), os: 3, attrs: 0o100600 << 16 }, (error, bytes) => {
      if (error) reject(error)
      else resolve(bytes)
    })
  })
  if (archive.byteLength > sharingLimits.transferBytes) throw new Error('Portable archive exceeds the 25 MiB transfer limit')
  return { manifest, archive, transferSha256: sha256(archive) }
}
