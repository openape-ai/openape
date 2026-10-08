import { _electron as electron } from 'playwright'
import { createRequire } from 'node:module'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { build } from 'tsup'
import { expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const builderRequire = createRequire(require.resolve('electron-builder'))
const archiveRequire = createRequire(builderRequire.resolve('app-builder-lib'))
const { createPackage } = archiveRequire('@electron/asar') as { createPackage: (source: string, destination: string) => Promise<void> }

it('backs up signed archive bytes in Electron instead of copying its virtual ASAR directory', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pods-update-asar-'))
  let running: Awaited<ReturnType<typeof electron.launch>> | undefined
  try {
    const installed = join(root, 'Installed.app'); const resources = join(installed, 'Contents/Resources')
    const source = join(root, 'source'); const profile = join(root, 'profile'); const archives = join(root, 'backups')
    await Promise.all([mkdir(resources, { recursive: true }), mkdir(source), mkdir(profile)])
    await writeFile(join(source, 'package.json'), JSON.stringify({ name: 'synthetic-archive', version: '1.0.0' }))
    await writeFile(join(profile, 'identity.json'), '{"identity":"synthetic-preserved"}')
    const archive = join(resources, 'app.asar'); await createPackage(source, archive)
    await build({ entry: { backup: resolve('src/main/update-backup.ts') }, outDir: join(root, 'module'), format: ['cjs'], platform: 'node', target: 'node24', silent: true, external: ['electron', 'original-fs'], outExtension: () => ({ js: '.cjs' }) })
    const entry = join(root, 'entry.cjs')
    await writeFile(entry, 'const {app}=require(\'electron\');app.commandLine.appendSwitch(\'use-mock-keychain\');app.setPath(\'userData\',__dirname);app.on(\'window-all-closed\',()=>{});globalThis.fixtureRequire=require;\n')
    running = await electron.launch({ executablePath: require('electron') as string, args: [entry], cwd: root, env: { HOME: root, TMPDIR: tmpdir(), PATH: '/usr/bin:/bin', NODE_ENV: 'test' }, timeout: 20000 })
    expect(await running.evaluate((_, path) => (globalThis as unknown as { fixtureRequire: NodeRequire }).fixtureRequire('node:fs').statSync(path).isDirectory(), archive)).toBe(true)
    const backup = await running.evaluate(async (_, options) => {
      const { backupForUpdate } = (globalThis as unknown as { fixtureRequire: NodeRequire }).fixtureRequire(options.module) as { backupForUpdate: (profile: string, app: string, archives: string) => Promise<string> }
      return backupForUpdate(options.profile, options.installed, options.archives)
    }, { module: join(root, 'module/backup.cjs'), profile, installed, archives })
    expect(await readFile(join(backup, 'OpenApe Pods.app/Contents/Resources/app.asar'))).toEqual(await readFile(archive))
    expect(await readFile(join(backup, 'profile/identity.json'), 'utf8')).toBe('{"identity":"synthetic-preserved"}')
    const manifest = JSON.parse(await readFile(join(backup, 'backup.json'), 'utf8'))
    expect(Object.keys(manifest.appFiles)).toEqual(['Contents/Resources/app.asar'])
  }
  finally { if (running) await running.close(); await rm(root, { recursive: true, force: true }) }
})
