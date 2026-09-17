import { createHash } from 'node:crypto'
import { chmod, lstat, readdir, readFile, realpath } from 'node:fs/promises'
import { join } from 'node:path'
import { parsePackages } from '../../contracts/dependencies'
import type { PackageManifest } from '../../contracts/dependencies'

export interface PackageFile { path: string, hash: string, size: number }
export const dependencyLimit = 64 * 1024 * 1024
export function checkLock(value: unknown, manifest: PackageManifest): void {
  const lock = value as { lockfileVersion?: number, packages?: Record<string, { version?: string, resolved?: string, integrity?: string, link?: boolean, hasInstallScript?: boolean, dependencies?: Record<string, string> }> }
  if (!lock || lock.lockfileVersion !== 3 || !lock.packages || Object.keys(lock.packages).length > 1000 || JSON.stringify(parsePackages({ dependencies: lock.packages['']?.dependencies ?? {} })) !== JSON.stringify(manifest)) throw new Error('Dependency lock does not match package.json')
  for (const [path, item] of Object.entries(lock.packages)) {
    if (!path) continue
    if (!/^node_modules\/(?:@[^/]+\/)?[^/]+(?:\/node_modules\/(?:@[^/]+\/)?[^/]+)*$/.test(path) || path.split('/').some(part => ['.', '..'].includes(part)) || item.link || item.hasInstallScript || typeof item.integrity !== 'string' || !/^sha512-[A-Za-z0-9+/]+=*$/.test(item.integrity) || !item.resolved) throw new Error('Dependency requires unsupported installation behavior')
    const url = new URL(item.resolved)
    if (url.protocol !== 'https:' || url.hostname !== 'registry.npmjs.org' || url.port || url.username || url.password || url.search || url.hash || !url.pathname.endsWith('.tgz')) throw new Error('Dependencies must come from the public npm registry')
  }
}
export async function packageFiles(root: string, freeze = false): Promise<PackageFile[]> {
  if (await realpath(root) !== root) throw new Error('Dependency directory was redirected')
  const result: PackageFile[] = []; let size = 0; let entries = 0
  async function walk(directory: string): Promise<void> {
    for (const child of await readdir(join(root, directory), { withFileTypes: true })) {
      if (++entries > 10000) throw new Error('Dependency tree exceeds its size limit')
      const path = directory ? `${directory}/${child.name}` : child.name
      if (/[\0\r\n\\]/.test(path)) throw new Error('Unsupported dependency path')
      const absolute = join(root, path); const stat = await lstat(absolute)
      if (stat.isDirectory()) { await walk(path); if (freeze) await chmod(absolute, 0o500); continue }
      if (!stat.isFile() || stat.nlink !== 1 || stat.size > dependencyLimit || size + stat.size > dependencyLimit) throw new Error('Dependency tree contains a link or exceeds its size limit')
      const content = await readFile(absolute); size += content.length
      if (content.length !== stat.size || size > dependencyLimit) throw new Error('Dependency tree changed during inspection')
      if (/\.(?:node|dylib|so|dll|exe|wasm)$/i.test(path) || ['7f454c46', 'cffaedfe', 'feedfacf', 'cafebabe', 'cefaedfe'].includes(content.subarray(0, 4).toString('hex')) || content.subarray(0, 2).toString() === 'MZ') throw new Error('Only pure JavaScript dependencies are supported')
      if (child.name === 'package.json') {
        const metadata = JSON.parse(content.toString()) as { scripts?: Record<string, unknown>, gypfile?: boolean }
        if (metadata.gypfile || ['preinstall', 'install', 'postinstall', 'prepare'].some(key => metadata.scripts?.[key])) throw new Error('Packages with installation scripts are not supported')
      }
      result.push({ path, size: content.length, hash: createHash('sha256').update(content).digest('hex') })
      if (freeze) await chmod(absolute, 0o400)
    }
  }
  await walk('')
  if (freeze) await chmod(root, 0o500)
  return result.sort((a, b) => a.path.localeCompare(b.path))
}
export function packageDigest(files: PackageFile[]): string { return createHash('sha256').update(JSON.stringify(files)).digest('hex') }
