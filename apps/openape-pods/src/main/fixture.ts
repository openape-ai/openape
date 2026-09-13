import { mkdirSync, lstatSync, readFileSync, writeFileSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'
import { tmpdir, userInfo } from 'node:os'

export function fixtureDirectory(override?: string): string {
  const root = override ?? join(tmpdir(), `openape-pods-fixture-${userInfo().uid}`)
  if (!isAbsolute(root)) throw new Error('Fixture directory must be absolute')
  mkdirSync(root, { recursive: true, mode: 0o700 })
  const info = lstatSync(root)
  if (!info.isDirectory() || info.isSymbolicLink() || info.uid !== userInfo().uid || (info.mode & 0o077) !== 0) throw new Error('Fixture directory must be private and owned by the current user')
  const marker = join(root, 'pods-fixture.json')
  try { writeFileSync(marker, '{"fixture":true,"version":1}\n', { flag: 'wx', mode: 0o600 }) }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    const stat = lstatSync(marker)
    if (!stat.isFile() || stat.isSymbolicLink() || readFileSync(marker, 'utf8') !== '{"fixture":true,"version":1}\n') throw new Error('Not a Pods fixture directory')
  }
  return root
}
