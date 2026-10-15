import { createHash, randomUUID } from 'node:crypto'
import { launchApeShell } from '../runtime/ape-shell'
import { observeExecution } from '../../main/programs/execution'
import { lstat, mkdir, readdir, readFile, statfs, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { ScriptRuntime } from '../runs/runner'
import type { PackageManifest } from '../../contracts/dependencies'
import { startNetworkProxy } from '../../main/network/proxy'
import { parseImportedLock, validateImportedLock, verifyImportedTree } from './imported-lock'
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
export async function installPackages(runtime: ScriptRuntime, stage: string, manifest: PackageManifest, signal: AbortSignal, register: (path: string, pid: number) => void, importedLock?: string): Promise<string> {
  const npm = join(dirname(runtime.entry), '../vendor/npm')
  const validatedLock = importedLock === undefined ? undefined : parseImportedLock(importedLock, manifest, npm)
  const project = join(stage, 'project'); const home = join(stage, 'home')
  await Promise.all([mkdir(project), mkdir(home)])
  await Promise.all([writeFile(join(project, 'package.json'), JSON.stringify(manifest)), writeFile(join(stage, 'user.npmrc'), ''), writeFile(join(stage, 'global.npmrc'), '')])
  if (validatedLock !== undefined) await writeFile(join(project, 'package-lock.json'), validatedLock, { flag: 'wx', mode: 0o600 })
  const proxy = await startNetworkProxy(signal, ['registry.npmjs.org'])
  const executionTimeout = new AbortController()
  const deadline = AbortSignal.any([signal, executionTimeout.signal])
  let remainingMs = 180000
  try {
    for (const command of validatedLock === undefined ? [['install', '--package-lock-only'], ['ci']] : [['ci']]) {
      deadline.throwIfAborted()
      const args = [join(npm, 'bin/npm-cli.js'), ...command, '--ignore-scripts', '--bin-links=false', '--audit=false', '--fund=false', '--update-notifier=false', '--fetch-retries=0', '--fetch-timeout=30000', '--registry=https://registry.npmjs.org/', `--https-proxy=${proxy.environment.HTTPS_PROXY}`, `--cache=${join(home, 'cache')}`, `--userconfig=${join(stage, 'user.npmrc')}`, `--globalconfig=${join(stage, 'global.npmrc')}`]
      const policy = { executable: runtime.executable, workspace: project, readFiles: [join(stage, 'user.npmrc'), join(stage, 'global.npmrc')], runtimeDirectories: runtime.runtimeDirectories, readDirectories: [npm], writeDirectories: [home], networkPorts: [proxy.port] }
      const environment = { ELECTRON_RUN_AS_NODE: '1', HOME: home, TMPDIR: home }
      const operationId = randomUUID()
      const pins = [args[0]!, join(project, 'package.json'), ...(command[0] === 'ci' ? [join(project, 'package-lock.json')] : [])]
      if (!runtime.machine) throw new Error('Dependency preparation requires ape-shell and its assigned identity')
      const domain = await launchApeShell(runtime.helper, stage, policy, args, environment, { ...runtime.machine, operationId, executableHash: createHash('sha256').update(await readFile(runtime.executable)).digest('hex'), files: await Promise.all(pins.map(async path => ({ path, sha256: createHash('sha256').update(await readFile(path)).digest('hex') }))) }, register)
      let startedAt: number | undefined; let timeout: ReturnType<typeof setTimeout> | undefined
      const startBudget = () => { startedAt = Date.now(); timeout = setTimeout(() => executionTimeout.abort(new Error('Dependency preparation exceeded its time limit')), remainingMs) }
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
        const result = await observeExecution(domain, operationId, { authorized: async () => { deadline.throwIfAborted(); startBudget() } }, deadline)
        const code = result.exitCode; deadline.throwIfAborted()
        await inspection
        if (storageError) throw storageError
        if (overflow || code !== 0) throw new Error(`Dependency preparation failed: ${output.replaceAll(proxy.environment.HTTPS_PROXY, '[registry proxy]').replaceAll(new URL(proxy.environment.HTTPS_PROXY).password, '[redacted]').slice(-4000)}`)
      }
      finally { clearTimeout(timeout); if (startedAt !== undefined) remainingMs = Math.max(0, remainingMs - (Date.now() - startedAt)); clearInterval(monitor); deadline.removeEventListener('abort', stop); domain.cancel(); await domain.completed; await inspection }
      const preparedLock = JSON.parse(await readFile(join(project, 'package-lock.json'), 'utf8'))
      checkLock(preparedLock, manifest)
      if (validatedLock !== undefined && validateImportedLock(preparedLock, manifest, npm) !== validatedLock) throw new Error('Imported dependency lock changed during preparation')
    }
    await checkStaging(stage)
    if (validatedLock !== undefined) await verifyImportedTree(project, validatedLock, manifest, npm, deadline)
    return project
  }
  finally { await proxy.close() }
}
