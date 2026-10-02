import { constants } from 'node:fs'
import { lstat, open, readdir, realpath } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { canonicalPortableJson } from '@openape/pods-protocol'
import { dataFields } from '../../contracts/network-data'
import { parsePackages } from '../../contracts/dependencies'
import { networkDataObject } from '../../contracts/network-payload'
import type { PackageManifest } from '../../contracts/dependencies'

interface LockEntry {
  name?: string
  version?: string
  dependencies?: Record<string, string>
  optionalDependencies?: Record<string, string>
  peerDependencies?: Record<string, string>
  peerDependenciesMeta?: Record<string, { optional: boolean }>
  resolved?: string
  integrity?: string
}
interface Semver { validRange: (value: string) => string | null, satisfies: (version: string, range: string) => boolean }

function packageName(name: string): string {
  parsePackages({ dependencies: { [name]: '1.0.0' } })
  return name
}
function dependencyMap(value: unknown, semver: Semver): Record<string, string> {
  if (value === undefined) return {}
  const fields = dataFields(value, Object.keys(networkDataObject(value)))
  if (Object.keys(fields).length > 1000) throw new Error('Imported dependency list exceeds its limit')
  for (const [name, range] of Object.entries(fields)) {
    packageName(name)
    if (typeof range === 'string' && range.startsWith('npm:')) throw new Error('Imported npm aliases are not supported; revise the package before export')
    if (typeof range !== 'string' || range.length > 200 || !semver.validRange(range)) throw new Error('Imported dependencies require supported registry version ranges')
  }
  return fields as Record<string, string>
}
function packagePath(path: string): string {
  if (!/^node_modules\/(?:@[^/]+\/)?[^/]+(?:\/node_modules\/(?:@[^/]+\/)?[^/]+)*$/.test(path) || path.length > 2048) throw new Error('Invalid imported dependency path')
  const names = path.replace(/^node_modules\//, '').split('/node_modules/')
  for (const name of names) packageName(name)
  return names.at(-1)!
}
function metadataText(value: unknown, limit: number): string {
  if (typeof value !== 'string' || value.length > limit || /[\0\r\n]/.test(value)) throw new Error('Invalid imported dependency metadata text')
  return value
}
function metadata(item: Record<string, unknown>, semver: Semver): void {
  for (const field of ['license', 'deprecated']) {
    if (item[field] !== undefined) metadataText(item[field], 4096)
  }
  for (const field of ['os', 'cpu']) {
    if (item[field] === undefined) continue
    const values = item[field]
    if (!Array.isArray(values) || values.length > 32 || values.some(value => typeof value !== 'string' || !/^!?[a-z0-9_-]{1,40}$/.test(value))) throw new Error('Invalid imported dependency platform metadata')
  }
  if (item.engines !== undefined) {
    const engines = networkDataObject(item.engines)
    if (Object.keys(engines).length > 16 || Object.entries(engines).some(([name, value]) => !/^[a-z0-9_-]{1,32}$/.test(name) || typeof value !== 'string' || value.length > 200 || !semver.validRange(value))) throw new Error('Invalid imported dependency engine metadata')
  }
  if (item.bin !== undefined) {
    const paths = typeof item.bin === 'string'
      ? [item.bin]
      : Object.entries(networkDataObject(item.bin)).map(([name, path]) => {
          if (!/^[\w.@-]{1,214}$/.test(name) || ['.', '..'].includes(name)) throw new Error('Invalid imported dependency executable metadata')
          return path
        })
    if (paths.length > 32 || paths.some(path => typeof path !== 'string' || !path || path.length > 1024 || /[\\\0\r\n]/.test(path) || path.startsWith('/') || path.split('/').includes('..'))) throw new Error('Invalid imported dependency executable metadata')
  }
  if (item.funding !== undefined) {
    const entries = Array.isArray(item.funding) ? item.funding : [item.funding]
    if (entries.length > 16) throw new Error('Invalid imported dependency funding metadata')
    for (const entry of entries) {
      const funding = typeof entry === 'string' ? { url: entry } : dataFields(entry, ['url'], ['type'])
      if (funding.type !== undefined) metadataText(funding.type, 100)
      const url = new URL(metadataText(funding.url, 2048))
      if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw new Error('Invalid imported dependency funding metadata')
    }
  }
}
function identityMetadata(item: Record<string, unknown>): void {
  if (item.name !== undefined) packageName(metadataText(item.name, 214))
  if (item.version !== undefined) parsePackages({ dependencies: { fixture: item.version } })
}

function entry(value: unknown, path: string, semver: Semver): LockEntry {
  const item = dataFields(value, ['version', 'resolved', 'integrity'], ['name', 'license', 'dependencies', 'optionalDependencies', 'peerDependencies', 'peerDependenciesMeta', 'engines', 'os', 'cpu', 'optional', 'devOptional', 'dev', 'bin', 'hasInstallScript', 'funding', 'peer', 'deprecated'])
  metadata(item, semver)
  const name = packagePath(path)
  parsePackages({ dependencies: { [name]: item.version } })
  if (item.name !== undefined && item.name !== name) throw new Error('Imported dependency name differs from its path')
  const version = item.version as string
  const expected = `https://registry.npmjs.org/${name}/-/${name.split('/').at(-1)}-${version}.tgz`
  if (item.resolved !== expected) throw new Error('Imported dependency tarball differs from its package identity')
  if (typeof item.integrity !== 'string' || !/^sha512-[A-Za-z0-9+/]{86}==$/.test(item.integrity) || Buffer.from(item.integrity.slice(7), 'base64').toString('base64') !== item.integrity.slice(7)) throw new Error('Imported dependency requires canonical SHA512 integrity')
  if (item.hasInstallScript !== undefined && item.hasInstallScript !== false) throw new Error('Imported dependencies cannot run installation scripts')
  for (const flag of ['optional', 'devOptional', 'dev', 'peer']) {
    if (item[flag] !== undefined && typeof item[flag] !== 'boolean') throw new Error('Invalid imported dependency flag')
  }
  if (item.dev === true || item.devOptional === true) throw new Error('Imported script locks cannot contain development dependencies')
  const dependencies = dependencyMap(item.dependencies, semver); const optionalDependencies = dependencyMap(item.optionalDependencies, semver); const peerDependencies = dependencyMap(item.peerDependencies, semver)
  if (item.peerDependenciesMeta !== undefined) {
    const metadata = dataFields(item.peerDependenciesMeta, Object.keys(networkDataObject(item.peerDependenciesMeta)))
    for (const [name, value] of Object.entries(metadata)) {
      const peer = dataFields(value, ['optional'])
      packageName(name)
      if (typeof peer.optional !== 'boolean') throw new Error('Invalid imported peer dependency metadata')
    }
  }
  return { ...item, dependencies, optionalDependencies, peerDependencies } as LockEntry
}

function inspectImportedLock(value: unknown, manifest: PackageManifest, npmRoot: string) {
  const clean = JSON.parse(canonicalPortableJson(value))
  const lock = dataFields(clean, ['lockfileVersion', 'packages'], ['name', 'version', 'requires'])
  if (lock.lockfileVersion !== 3 || (lock.requires !== undefined && lock.requires !== true)) throw new Error('Imported dependency lock requires version 3')
  const packages = dataFields(lock.packages, Object.keys(networkDataObject(lock.packages)))
  if (!Object.hasOwn(packages, '') || Object.keys(packages).length > 1000) throw new Error('Imported dependency lock exceeds its package limit')
  const root = dataFields(packages[''], [], ['dependencies', 'name', 'version'])
  if (canonicalPortableJson(parsePackages({ dependencies: root.dependencies ?? {} })) !== canonicalPortableJson(parsePackages(manifest))) throw new Error('Imported dependency lock does not match package.json')
  identityMetadata(lock); identityMetadata(root)
  const semver = createRequire(join(npmRoot, 'package.json'))('semver') as Semver
  const entries = new Map(Object.entries(packages).filter(([path]) => path !== '').map(([path, value]) => [path, entry(value, path, semver)]))
  const resolve = (from: string, name: string): string | undefined => {
    for (let path = from; ;) {
      const candidate = `${path ? `${path}/` : ''}node_modules/${name}`
      if (entries.has(candidate)) return candidate
      if (!path) return undefined
      const boundary = path.lastIndexOf('/node_modules/'); path = boundary < 0 ? '' : path.slice(0, boundary)
    }
  }
  const visited = new Set<string>(); const required = new Set<string>()
  const requiredChildren = new Map<string, Set<string>>()
  const pending: [string, LockEntry, boolean][] = [['', { dependencies: manifest.dependencies }, true]]
  while (pending.length) {
    const [path, item, mandatory] = pending.pop()!
    const dependencies = Object.entries({ ...item.dependencies, ...item.optionalDependencies }).map(([name, range]) => ({ name, range, optional: Object.hasOwn(item.optionalDependencies ?? {}, name) }))
    dependencies.push(...Object.entries(item.peerDependencies ?? {}).map(([name, range]) => ({ name, range, optional: item.peerDependenciesMeta?.[name]?.optional === true })))
    for (const { name, range, optional } of dependencies) {
      const target = resolve(path, name)
      if (!target) {
        if (optional) continue
        throw new Error('Imported dependency lock has an unresolved dependency')
      }
      const dependency = entries.get(target)!
      if (!semver.satisfies(dependency.version!, range)) throw new Error('Imported dependency version does not satisfy its parent')
      if (!optional) {
        const children = requiredChildren.get(path) ?? new Set<string>()
        children.add(target); requiredChildren.set(path, children)
      }
      const needed = mandatory && !optional
      if (visited.has(target) && (!needed || required.has(target))) continue
      visited.add(target); if (needed) required.add(target)
      pending.push([target, dependency, needed])
    }
  }
  if (visited.size !== entries.size) throw new Error('Imported dependency lock contains unreachable packages')
  return { canonical: canonicalPortableJson(clean), entries, required, requiredChildren }
}

export function parseImportedLock(source: string, manifest: PackageManifest, npmRoot: string): string {
  if (Buffer.byteLength(source, 'utf8') > 1024 * 1024) throw new Error('Imported dependency lock exceeds 1 MiB')
  return validateImportedLock(JSON.parse(source), manifest, npmRoot)
}

export function validateImportedLock(value: unknown, manifest: PackageManifest, npmRoot: string): string {
  return inspectImportedLock(value, manifest, npmRoot).canonical
}

function dependencyEdges(value: LockEntry): string {
  const optionalDependencies = value.optionalDependencies ?? {}
  const dependencies = Object.fromEntries(Object.entries(value.dependencies ?? {}).filter(([name]) => !Object.hasOwn(optionalDependencies, name)))
  return canonicalPortableJson({ dependencies, optionalDependencies, peerDependencies: value.peerDependencies ?? {}, peerDependenciesMeta: value.peerDependenciesMeta ?? {} })
}

async function verifyListedPackages(root: string, parent: string, entries: Map<string, LockEntry>): Promise<void> {
  const prefix = `${parent ? `${parent}/` : ''}node_modules`
  let children: string[]
  try { children = await readdir(join(root, prefix)) }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error }
  for (const child of children) {
    if (child === '.package-lock.json') continue
    const path = `${prefix}/${child}`
    if (child.startsWith('@')) {
      if (!(await lstat(join(root, path))).isDirectory()) throw new Error('Imported dependency directory was redirected')
      for (const scoped of await readdir(join(root, path))) {
        if (!entries.has(`${path}/${scoped}`)) throw new Error('Installed dependency tree contains an unlisted package')
      }
    }
    else if (!entries.has(path)) {
      throw new Error('Installed dependency tree contains an unlisted package')
    }
  }
}

export async function verifyImportedTree(project: string, lock: string, manifest: PackageManifest, npmRoot: string, signal: AbortSignal): Promise<void> {
  const inspected = inspectImportedLock(JSON.parse(lock), manifest, npmRoot)
  const root = await realpath(project)
  const present = new Set<string>([''])
  await verifyListedPackages(root, '', inspected.entries)
  for (const [path, entry] of inspected.entries) {
    signal.throwIfAborted()
    const directory = join(root, path)
    let resolved: string
    try { resolved = await realpath(directory) }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      if (inspected.required.has(path)) throw new Error('Imported dependency tree is missing a required package')
      continue
    }
    if (resolved !== directory) throw new Error('Imported dependency directory was redirected')
    present.add(path)
    const file = await open(join(directory, 'package.json'), constants.O_RDONLY | constants.O_NOFOLLOW)
    try {
      const stat = await file.stat()
      if (!stat.isFile() || stat.nlink !== 1 || stat.size > 1024 * 1024) throw new Error('Invalid installed dependency metadata')
      const bytes = await file.readFile()
      if (bytes.length !== stat.size) throw new Error('Installed dependency metadata changed')
      const metadata = JSON.parse(bytes.toString('utf8'))
      if (metadata.name !== packagePath(path) || metadata.version !== entry.version) throw new Error('Installed dependency identity differs from the imported lock')
      if (dependencyEdges(metadata) !== dependencyEdges(entry)) throw new Error('Installed dependency requirements differ from the imported lock')
      if (metadata.bundleDependencies?.length || metadata.bundledDependencies?.length || metadata.bundleDependencies === true || metadata.bundledDependencies === true) throw new Error('Bundled dependencies are not supported in imported packages')
    }
    finally { await file.close() }
    await verifyListedPackages(root, path, inspected.entries)
  }
  for (const [parent, children] of inspected.requiredChildren) {
    if (present.has(parent) && [...children].some(child => !present.has(child))) throw new Error('Imported dependency tree is missing a required package')
  }
}
