import { autoUpdater as nativeUpdater } from 'electron'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { mkdtemp, readFile, realpath, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { MacUpdater } from 'electron-updater'
import { parsePodsRelease, podsReleaseOrigin, podsUpdatePath } from '@openape/pods-protocol'
import type { PodsRelease } from '@openape/pods-protocol'
import { assertUpdate, verifyUpdate } from './update'
import type { DistributionManifest } from './update'
import { AutomaticUpdate } from './automatic-update'
import { backupForUpdate } from './update-backup'

const execute = promisify(execFile)
export async function assertNoExternalAppProcesses(executable: string): Promise<void> {
  const { stdout } = await execute('/bin/ps', ['-axo', 'pid=,command='], { maxBuffer: 8 * 1024 * 1024, timeout: 10000 })
  if (stdout.split('\n').some((line) => {
    const match = /^\s*(\d+)\s+(\S.*)$/.exec(line)
    return match && Number(match[1]) !== process.pid && (match[2] === executable || match[2].startsWith(`${executable} `))
  })) {
    throw new Error('Close external Pods MCP sessions before installing the update')
  }
}
async function verifyArchive(archive: string, installed: string, release: PodsRelease): Promise<void> {
  const digest = createHash('sha256'); let size = 0
  for await (const bytes of createReadStream(archive)) { size += bytes.length; digest.update(bytes) }
  if (size !== release.files.zip.size || digest.digest('hex') !== release.files.zip.sha256) throw new Error('Update archive checksum mismatch')
  const stage = await realpath(await mkdtemp(join(tmpdir(), 'pods-update-')))
  try {
    // macOS sandbox confines archive expansion, including symlink targets, before signature verification.
    const policy = `(version 1)(allow default)(deny network*)(deny file-write*)(allow file-write* (subpath ${JSON.stringify(stage)}))`
    await execute('/usr/bin/sandbox-exec', ['-p', policy, '/usr/bin/ditto', '-x', '-k', archive, stage], { timeout: 180000 })
    const manifest = await verifyUpdate(installed, join(stage, 'OpenApe Pods.app'))
    if (manifest.version !== release.version || manifest.schema.current !== release.schema.current || manifest.schema.minimum !== release.schema.minimum || manifest.sourceRevision !== release.sourceRevision || manifest.dependencyLockHash !== release.dependencyLockHash) throw new Error('Release metadata differs from the signed app')
  }
  finally { await rm(stage, { recursive: true, force: true }) }
}
export async function createAutomaticUpdate(options: { version: string, installed: string, executable: string, profile: string, backups: string, freeze: () => Promise<void>, resume: () => Promise<void>, beforeQuit: () => void }): Promise<AutomaticUpdate> {
  const current = JSON.parse(await readFile(join(options.installed, 'Contents/Resources/pods-distribution.json'), 'utf8')) as DistributionManifest
  const updater = new MacUpdater({ provider: 'generic', url: `${podsReleaseOrigin}${podsUpdatePath}`, useMultipleRangeRequest: false })
  nativeUpdater.on('before-quit-for-update', options.beforeQuit)
  updater.autoDownload = false
  updater.autoInstallOnAppQuit = false
  updater.allowDowngrade = false
  updater.allowPrerelease = false
  updater.disableDifferentialDownload = true
  let selected: PodsRelease | null = null
  let downloaded = ''
  let progress: (percent: number) => void = () => {}
  updater.on('download-progress', value => progress(value.percent))
  updater.on('update-downloaded', (value) => { downloaded = value.downloadedFile })
  const controller = new AutomaticUpdate(options.version, {
    check: async () => {
      const response = await fetch(`${podsReleaseOrigin}${podsUpdatePath}release.json`, { redirect: 'error', signal: AbortSignal.timeout(15000) })
      if (response.status === 404) return null
      if (!response.ok) throw new Error(`Update server returned HTTP ${response.status}`)
      const text = await response.text()
      if (text.length > 65536) throw new Error('Update metadata exceeds its limit')
      const release = parsePodsRelease(JSON.parse(text))
      const previous = options.version.split('.').map(Number); const next = release.version.split('.').map(Number)
      const difference = next.findIndex((part, index) => part !== previous[index])
      if (difference < 0 || next[difference] < previous[difference]) return null
      assertUpdate(current, { ...release, format: 'openape-pods-distribution' })
      const result = await updater.checkForUpdates()
      if (!result || result.updateInfo.version !== release.version || result.updateInfo.files.length !== 1 || result.updateInfo.files[0].url !== `releases/${release.version}/${release.files.zip.name}` || result.updateInfo.files[0].sha512 !== release.files.zip.sha512) throw new Error('Release changed during update check; try again')
      selected = release
      return release
    },
    download: async (release, onProgress) => {
      if (selected !== release) throw new Error('Update selection expired')
      progress = onProgress; downloaded = ''
      await updater.downloadUpdate()
      if (!downloaded) throw new Error('Update download did not produce an archive')
      return downloaded
    },
    verify: (archive, release) => verifyArchive(archive, options.installed, release),
    freeze: async () => { await assertNoExternalAppProcesses(options.executable); await options.freeze() },
    backup: async () => {
      await assertNoExternalAppProcesses(options.executable)
      return backupForUpdate(options.profile, options.installed, options.backups)
    },
    resume: options.resume,
    install: async () => { await assertNoExternalAppProcesses(options.executable); updater.quitAndInstall() },
  })
  updater.on('error', error => controller.fail(error))
  return controller
}
