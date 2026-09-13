import { closeSync, existsSync, fsyncSync, lstatSync, openSync, readFileSync, realpathSync, renameSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { randomUUID } from 'node:crypto'
import { localDirectory } from './fixture'

export function selectedProfile(base: string): string {
  const canonical = realpathSync(base); const path = join(canonical, 'selected-profile.json')
  if (!existsSync(path)) return canonical
  const info = lstatSync(path)
  if (!info.isFile() || info.isSymbolicLink() || info.size > 1024) throw new Error('Invalid selected profile record')
  const value = JSON.parse(readFileSync(path, 'utf8')) as { profile?: string }
  if (typeof value.profile !== 'string' || !/^profiles\/[a-f0-9-]{36}$/.test(value.profile)) throw new Error('Invalid selected profile path')
  const profile = join(canonical, value.profile)
  if (realpathSync(profile) !== profile) throw new Error('Selected profile must not contain links')
  return localDirectory(profile)
}
export function selectProfile(base: string, profile: string): void {
  const canonical = realpathSync(base); const value = relative(canonical, realpathSync(profile))
  if (!/^profiles\/[a-f0-9-]{36}$/.test(value)) throw new Error('Restored profile is outside this application')
  localDirectory(profile)
  const staging = join(canonical, `.profile-${randomUUID()}`); const file = openSync(staging, 'wx', 0o600)
  try { writeFileSync(file, JSON.stringify({ profile: value })); fsyncSync(file) }
  finally { closeSync(file) }
  renameSync(staging, join(canonical, 'selected-profile.json'))
  const directory = openSync(canonical, 'r'); try { fsyncSync(directory) }
  finally { closeSync(directory) }
}
