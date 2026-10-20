import { realpathSync, statSync } from 'node:fs'
import { basename, dirname, isAbsolute, join, resolve, sep } from 'node:path'

let protectedPaths: string[] = []

function canonicalPath(path: string): string {
  try { return realpathSync.native(path) }
  catch (error) {
    if (['EACCES', 'EPERM', 'ELOOP', 'ENOTDIR'].includes((error as NodeJS.ErrnoException).code ?? '')) return path
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error('Protected path resolution failed')
    const parent = dirname(path)
    if (parent === path) throw new Error('Protected path resolution failed')
    return join(canonicalPath(parent), basename(path))
  }
}

export function setMandatorySecretPaths(paths: string[]): void {
  if (!Array.isArray(paths) || paths.length > 64 || paths.some(path => typeof path !== 'string' || !isAbsolute(path) || path.length > 4096 || /[\0\r\n\\"]/.test(path))) throw new Error('Invalid protected runtime paths')
  protectedPaths = [...new Set(paths.flatMap(path => [resolve(path), canonicalPath(resolve(path))]))]
}

export function mandatorySecretPaths(): string[] {
  return [...new Set(protectedPaths.flatMap(path => [path, canonicalPath(path)]))]
}

function identity(path: string): string | undefined {
  try { const stat = statSync(path, { bigint: true }); return `${stat.dev}:${stat.ino}` }
  catch (error) {
    if (['ENOENT', 'EACCES', 'EPERM', 'ELOOP', 'ENOTDIR'].includes((error as NodeJS.ErrnoException).code ?? '')) return undefined
    throw new Error('Protected path inspection failed')
  }
}

export function assertNotSecretPath(path: string): void {
  const closed = mandatorySecretPaths()
  if (!closed.length) return
  const candidate = resolve(path)
  const forms = [candidate, canonicalPath(candidate)]
  if (forms.some(form => closed.some(secret => form === secret || form.startsWith(`${secret}${sep}`)))) throw new Error('Runtime credential and configuration files cannot be assigned to a Pod')
  const candidateIdentity = identity(candidate)
  if (candidateIdentity && closed.some(secret => identity(secret) === candidateIdentity)) throw new Error('Runtime credential and configuration files cannot be assigned to a Pod')
}
