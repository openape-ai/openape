// @vitest-environment node
import { randomUUID } from 'node:crypto'
import { existsSync, linkSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { assertNotSecretPath, mandatorySecretPaths, setMandatorySecretPaths } from '../../src/runtime/secret-paths'
import { createSnapshotSet } from '../../src/worker/resources/snapshots'

const roots: string[] = []
afterEach(() => { setMandatorySecretPaths([]); for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })
function fixture() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'pods-protected-reference-'))); roots.push(root)
  const privateDirectory = join(root, 'private'); const alias = join(root, 'alias')
  mkdirSync(privateDirectory); symlinkSync(privateDirectory, alias)
  const key = join(privateDirectory, 'key.json'); writeFileSync(key, '{"api_key":"fixture-only-key"}', { mode: 0o600 })
  const config = join(root, 'agent-backends.json'); writeFileSync(config, '{}', { mode: 0o600 })
  const hardlink = join(root, 'ordinary-looking-reference.txt'); linkSync(key, hardlink)
  setMandatorySecretPaths([join(alias, 'key.json'), config])
  return { root, key, config, alias, hardlink }
}

it('uses written and canonical paths, aliases and file identity without overmatching adjacent filenames', () => {
  const f = fixture()
  expect(mandatorySecretPaths()).toEqual([join(f.alias, 'key.json'), f.key, f.config])
  for (const path of [f.key, f.config, join(f.alias, 'key.json'), f.hardlink]) expect(() => assertNotSecretPath(path)).toThrow('cannot be assigned to a Pod')
  expect(() => assertNotSecretPath(`${f.key}.example`)).not.toThrow()
  expect(() => assertNotSecretPath(join(f.root, 'ordinary.txt'))).not.toThrow()
  const paths = mandatorySecretPaths(); paths.length = 0
  expect(() => assertNotSecretPath(f.key)).toThrow('cannot be assigned to a Pod')
})

it('protects absent configuration paths through an existing parent alias before the files are created', () => {
  const f = fixture(); const absent = join(f.alias, 'next/agent-backends.json')
  setMandatorySecretPaths([absent])
  expect(mandatorySecretPaths()).toEqual([absent, join(f.root, 'private/next/agent-backends.json')])
  expect(() => assertNotSecretPath(join(f.root, 'private/next/agent-backends.json'))).toThrow('cannot be assigned to a Pod')
})

it('refuses reference capture before running a helper or writing a snapshot, also for scheduler captures', async () => {
  const f = fixture(); const destination = join(f.root, 'snapshots')
  for (const path of [f.key, f.config, join(f.alias, 'key.json'), f.hardlink]) {
    await expect(createSnapshotSet('/missing-capture-helper', destination, [{ id: randomUUID(), revision: 1, path }])).rejects.toThrow('cannot be assigned to a Pod')
  }
  expect(existsSync(destination)).toBe(false)
  expect(await createSnapshotSet('/missing-capture-helper', destination, [])).toMatchObject({ files: [] })
})

it('rejects malformed trusted path metadata without clearing the current protections', () => {
  const f = fixture()
  for (const paths of [['relative'], ['/tmp/bad\npath'], [''], Array.from({ length: 65 }, () => '/tmp/key')]) expect(() => setMandatorySecretPaths(paths)).toThrow('Invalid protected runtime paths')
  expect(() => assertNotSecretPath(f.key)).toThrow('cannot be assigned to a Pod')
})

it.each(['EACCES', 'EPERM', 'ELOOP', 'ENOTDIR'])('keeps an unavailable configured path denied without disabling unrelated native execution (%s)', (code) => {
  const f = fixture(); const original = realpathSync.native
  const inspection = vi.spyOn(realpathSync, 'native').mockImplementation((path) => {
    if (path === f.key) throw Object.assign(new Error('Unavailable private path'), { code })
    return original(path)
  })
  try {
    expect(() => setMandatorySecretPaths([f.key])).not.toThrow()
    expect(mandatorySecretPaths()).toContain(f.key)
    expect(() => assertNotSecretPath(f.key)).toThrow('cannot be assigned to a Pod')
    expect(() => assertNotSecretPath(join(f.root, 'ordinary.txt'))).not.toThrow()
  }
  finally { inspection.mockRestore() }
})
