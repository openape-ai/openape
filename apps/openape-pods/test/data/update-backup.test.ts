// @vitest-environment node
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { backupForUpdate } from '../../src/main/update-backup'

const paths: string[] = []
afterEach(async () => { for (const path of paths.splice(0)) await rm(path, { recursive: true, force: true }) })
it('pairs the app with a verified full profile, encrypted credentials and identity; excludes Chromium and SQLite transient files', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pods-upgrade-backup-')); paths.push(root)
  const profile = join(root, 'profile'); const app = join(root, 'Installed.app')
  for (const path of ['credentials', 'central', 'chromium']) await mkdir(join(profile, path), { recursive: true })
  await mkdir(app)
  for (const [path, data] of [['control.sqlite', 'database'], ['credentials/key.enc', 'SYNTHETIC_ENCRYPTED'], ['central/identity.json', 'SYNTHETIC_IDENTITY'], ['chromium/cache', 'not-backed-up'], ['control.sqlite-wal', 'checkpointed']]) await writeFile(join(profile, path), data)
  await writeFile(join(app, 'binary'), 'old-app'); await symlink('binary', join(app, 'alias'))
  const backup = await backupForUpdate(profile, app, join(root, 'backups'))
  expect(await readFile(join(backup, 'profile/credentials/key.enc'), 'utf8')).toBe('SYNTHETIC_ENCRYPTED')
  expect(await readFile(join(backup, 'profile/central/identity.json'), 'utf8')).toBe('SYNTHETIC_IDENTITY')
  expect(await readFile(join(backup, 'OpenApe Pods.app/alias'), 'utf8')).toBe('old-app')
  const manifest = JSON.parse(await readFile(join(backup, 'backup.json'), 'utf8'))
  expect(Object.keys(manifest.files).sort()).toEqual(['central/identity.json', 'control.sqlite', 'credentials/key.enc'])
})
