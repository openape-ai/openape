import { lstat, mkdir, readdir, readFile, statfs, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { ScriptRuntime } from '../runs/runner'
import type { PackageManifest } from '../../contracts/dependencies'
import { startMailProxy } from '../../main/mail/proxy'
import { launchSandbox } from '../runtime/sandbox'
import { checkLock, dependencyLimit } from './tree'

async function checkStaging(root: string): Promise<void> {
  let bytes = 0; let entries = 0
  async function inspect(path: string): Promise<void> {
    let names: string[]
    try { names = await readdir(path) }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error }
    for (const name of names) {
      if (++entries > 30000) throw new Error('Dependency preparation exceeded its storage limit')
      const child = join(path, name)
      let stat
      try { stat = await lstat(child) }
      catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue; throw error }
      if (stat.isDirectory()) {
        await inspect(child)
      }
      else { bytes += stat.size; if (!stat.isFile() || bytes > dependencyLimit * 3) throw new Error('Dependency preparation exceeded its storage limit') }
    }
  }
  await inspect(root)
  const disk = await statfs(root)
  if (disk.bavail * disk.bsize < 256 * 1024 * 1024) throw new Error('Less than 256 MiB free disk space remains. Free space before continuing.')
}
export async function installPackages(runtime: ScriptRuntime, stage: string, manifest: PackageManifest, signal: AbortSignal, register: (path: string, pid: number) => void): Promise<string> {
  const project = join(stage, 'project'); const home = join(stage, 'home')
  await Promise.all([mkdir(project), mkdir(home)])
  await Promise.all([writeFile(join(project, 'package.json'), JSON.stringify(manifest)), writeFile(join(stage, 'user.npmrc'), ''), writeFile(join(stage, 'global.npmrc'), '')])
  const npm = join(dirname(runtime.entry), '../vendor/npm')
  const proxy = await startMailProxy(signal, undefined, ['registry.npmjs.org'])
  const deadline = AbortSignal.any([signal, AbortSignal.timeout(180000)])
  try {
    for (const command of [['install', '--package-lock-only'], ['ci']]) {
      deadline.throwIfAborted()
      const args = [join(npm, 'bin/npm-cli.js'), ...command, '--ignore-scripts', '--bin-links=false', '--audit=false', '--fund=false', '--update-notifier=false', '--fetch-retries=0', '--fetch-timeout=30000', '--registry=https://registry.npmjs.org/', `--https-proxy=${proxy.environment.HTTPS_PROXY}`, `--cache=${join(home, 'cache')}`, `--userconfig=${join(stage, 'user.npmrc')}`, `--globalconfig=${join(stage, 'global.npmrc')}`]
      const domain = await launchSandbox(runtime.helper, stage, { executable: runtime.executable, workspace: project, readFiles: [join(stage, 'user.npmrc'), join(stage, 'global.npmrc')], runtimeDirectories: runtime.runtimeDirectories, readDirectories: [npm], writeDirectories: [home], networkPorts: [proxy.port] }, args, { ELECTRON_RUN_AS_NODE: '1', HOME: home, TMPDIR: home }, register)
      const stop = () => domain.cancel(); deadline.addEventListener('abort', stop, { once: true }); if (deadline.aborted) stop()
      let output = ''; let overflow = false; let inspection: Promise<void> | undefined; let storageError: unknown
      const monitor = setInterval(() => {
        if (inspection) return
        inspection = checkStaging(stage).catch((error: unknown) => { storageError = error; domain.cancel() }).finally(() => { inspection = undefined })
      }, 200)
      const collect = (chunk: Buffer) => { output += chunk.toString(); if (output.length > 256 * 1024) { overflow = true; domain.cancel() } }
      domain.stdout.on('data', collect); domain.stderr.on('data', collect)
      try {
        await domain.processId
        const code = await domain.completed; deadline.throwIfAborted()
        await inspection
        if (storageError) throw storageError
        if (overflow || code !== 0) throw new Error(`Dependency preparation failed: ${output.replaceAll(proxy.environment.HTTPS_PROXY, '[registry proxy]').replaceAll(new URL(proxy.environment.HTTPS_PROXY).password, '[redacted]').slice(-4000)}`)
      }
      finally { clearInterval(monitor); deadline.removeEventListener('abort', stop); domain.cancel(); await domain.completed; await inspection }
      checkLock(JSON.parse(await readFile(join(project, 'package-lock.json'), 'utf8')), manifest)
    }
    await checkStaging(stage)
    return project
  }
  finally { await proxy.close() }
}
