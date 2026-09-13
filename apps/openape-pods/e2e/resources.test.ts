import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { createHash, randomUUID } from 'node:crypto'
import { mkdtemp, mkdir, readFile, realpath, readdir, rm, symlink, writeFile, rename } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createSnapshotSet } from '../src/worker/resources/snapshots'
import { launchSandbox, verifyExecutable } from '../src/worker/runtime/sandbox'
import type { ProcessDomain } from '../src/worker/runtime/sandbox'

const roots: string[] = []
const domains: ProcessDomain[] = []
const helper = resolve('dist/native/pods-helper')
async function fixture() {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'pods-native-'))); roots.push(root)
  const workspace = join(root, 'pod-a'); const sibling = join(root, 'pod-b'); const broker = join(root, 'broker')
  await Promise.all([mkdir(workspace), mkdir(sibling), mkdir(broker)])
  return { root, workspace, sibling, broker }
}
afterEach(async () => { for (const domain of domains.splice(0)) { domain.cancel(); await domain.completed } for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }) })
async function runProbe(root: Awaited<ReturnType<typeof fixture>>, script: string, readFiles: string[] = [], packaged = false) {
  const file = join(root.broker, `${randomUUID()}.mjs`); await writeFile(file, script)
  const bundle = resolve('release/mac-arm64/OpenApe Pods Fixture.app/Contents')
  const executable = packaged ? join(bundle, 'MacOS/OpenApe Pods Fixture') : process.execPath
  const binary = packaged ? join(bundle, 'Resources/app.asar.unpacked/dist/native/pods-helper') : helper
  const domain = await launchSandbox(binary, root.broker, { executable, workspace: root.workspace, readFiles: [file, ...readFiles], runtimeDirectories: packaged ? [bundle] : [] }, [file], packaged ? { ELECTRON_RUN_AS_NODE: '1' } : {})
  domains.push(domain)
  let output = ''; let error = ''
  domain.stdout.on('data', (bytes) => { output += bytes.toString() }); domain.stderr.on('data', (bytes) => { error += bytes.toString() })
  const pid = await domain.processId
  const exit = await domain.completed
  return { exit, output, error, pid }
}
describe('native resource boundary', () => {
  it('treats repeated cancellation as one lease close without write errors', async () => {
    const root = await fixture(); const error = vi.spyOn(console, 'error')
    const script = join(root.broker, 'waiting.mjs'); await writeFile(script, 'setInterval(() => {}, 1000)')
    const domain = await launchSandbox(helper, root.broker, { executable: process.execPath, workspace: root.workspace, readFiles: [script], runtimeDirectories: [] }, [script]); domains.push(domain)
    try { await domain.processId; domain.cancel(); domain.cancel(); await domain.completed; expect(error).not.toHaveBeenCalled() }
    finally { error.mockRestore() }
  })
  it('captures immutable per-run copies and rejects source symlinks including parent components', async () => {
    const root = await fixture(); const source = join(root.root, 'reference.txt'); const destination = join(root.broker, 'snapshots')
    await writeFile(source, 'version one')
    const assignment = { id: randomUUID(), revision: 1, path: source }
    const first = await createSnapshotSet(helper, destination, [assignment])
    await writeFile(source, 'version two')
    const next = await createSnapshotSet(helper, destination, [assignment])
    expect(await readFile(first.files[0]!.content, 'utf8')).toBe('version one')
    expect(await readFile(next.files[0]!.content, 'utf8')).toBe('version two')
    const alias = join(root.root, 'alias'); await symlink(root.root, alias)
    await expect(createSnapshotSet(helper, destination, [{ ...assignment, path: join(alias, 'reference.txt') }])).rejects.toThrow()
    const link = join(root.root, 'link'); await symlink(source, link)
    await expect(createSnapshotSet(helper, destination, [{ ...assignment, path: link }])).rejects.toThrow()
    expect((await readdir(destination)).filter(name => name.startsWith('.stage-'))).toEqual([])
    await rename(source, join(root.root, 'moved'))
    await expect(createSnapshotSet(helper, destination, [assignment])).rejects.toThrow()
  })
  it.each([false, true])('denies cross-pod/auth/snapshot writes, fork and direct network (packaged=%s)', async (packaged) => {
    const root = await fixture(); const secret = join(root.broker, 'agent-auth'); const sibling = join(root.sibling, 'private.txt'); const reference = join(root.broker, 'reference.txt')
    await Promise.all([writeFile(secret, 'SYNTHETIC_AUTH'), writeFile(sibling, 'OTHER_POD'), writeFile(reference, 'REFERENCE')])
    await symlink(secret, join(root.workspace, 'alias'))
    const server = createServer((_request, response) => response.end('UNASSIGNED'))
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const address = server.address(); if (!address || typeof address === 'string') throw new Error('Missing fixture listener')
    const script = `import fs from 'node:fs'; import {spawnSync} from 'node:child_process';
      const results={};
      for (const [name,path] of Object.entries(${JSON.stringify({ auth: secret, sibling, symlink: join(root.workspace, 'alias') })})) {
        try { fs.readFileSync(path); results[name]='allowed'; } catch(error) { results[name]=error.code; }
      }
      results.reference=fs.readFileSync(${JSON.stringify(reference)},'utf8');
      try {fs.writeFileSync(${JSON.stringify(reference)},'tampered');results.snapshotWrite='allowed';}catch(error){results.snapshotWrite=error.code;}
      fs.writeFileSync('own.txt','OWN');results.own=fs.readFileSync('own.txt','utf8');
      const fork=spawnSync('/usr/bin/true');results.fork=fork.error?.code??fork.status;
      try {await fetch('http://127.0.0.1:${address.port}/',{signal:AbortSignal.timeout(1000)});results.network='allowed';}catch{results.network='denied';}
      results.hostSecret=process.env.PODS_UNASSIGNED_SECRET??null;
      console.log(JSON.stringify(results));`
    try {
      const result = await runProbe(root, script, [reference], packaged)
      expect(result.exit, result.error).toBe(0)
      expect(JSON.parse(result.output)).toEqual({ auth: 'EPERM', sibling: 'EPERM', symlink: 'EPERM', reference: 'REFERENCE', snapshotWrite: 'EPERM', own: 'OWN', fork: 'EPERM', network: 'denied', hostSecret: null })
      expect(await readFile(secret, 'utf8')).toBe('SYNTHETIC_AUTH'); expect(await readFile(reference, 'utf8')).toBe('REFERENCE')
      const control = await runProbe(root, `import fs from 'node:fs'; console.log(fs.readFileSync(${JSON.stringify(secret)},'utf8'))`, [secret], packaged)
      expect(control.exit, control.error).toBe(0); expect(control.output).toContain('SYNTHETIC_AUTH')
    }
    finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())) }
  })
  it('terminates a SIGSTOP-frozen process when its supervisor lease closes', async () => {
    const root = await fixture(); const file = join(root.broker, 'wait.mjs'); await writeFile(file, 'setInterval(()=>{},1000)')
    const domain = await launchSandbox(helper, root.broker, { executable: process.execPath, workspace: root.workspace, readFiles: [file], runtimeDirectories: [] }, [file]); domains.push(domain)
    let diagnostics = ''
    domain.stderr.on('data', (bytes) => { diagnostics += bytes.toString() })
    const pid = await domain.processId
    process.kill(pid, 'SIGSTOP'); domain.guardian.stdin!.end()
    expect(await domain.completed, diagnostics).toBe(125)
    expect(() => process.kill(pid, 0)).toThrow()
  })
  it('kills its owned domain after the actual controlling process crashes', async () => {
    const root = await fixture()
    const file = join(root.broker, 'wait.mjs'); await writeFile(file, 'setInterval(()=>{},1000)')
    const module = resolve('src/worker/runtime/sandbox.ts')
    const script = `import {launchSandbox} from ${JSON.stringify(module)};
      const domain=await launchSandbox(${JSON.stringify(helper)},${JSON.stringify(root.broker)},${JSON.stringify({ executable: process.execPath, workspace: root.workspace, readFiles: [file], runtimeDirectories: [] })},[${JSON.stringify(file)}]);
      const pid=await domain.processId; console.log(JSON.stringify({pid,guardian:domain.guardian.pid})); await domain.completed;`
    const supervisor = spawn(process.execPath, ['--experimental-transform-types', '--input-type=module', '-e', script], { env: { PATH: '/usr/bin:/bin' }, stdio: ['ignore', 'pipe', 'pipe'] })
    let diagnostics = ''; supervisor.stderr.on('data', (bytes) => { diagnostics += bytes.toString() })
    let identifiers: { pid: number, guardian: number } | undefined
    supervisor.stdout.on('data', (bytes) => { identifiers = JSON.parse(bytes.toString()) })
    try {
      await expect.poll(() => identifiers, { timeout: 5000 }).toBeDefined()
      if (!identifiers) throw new Error(diagnostics || 'Missing process registration')
      const { pid, guardian } = identifiers
      process.kill(pid, 'SIGSTOP'); supervisor.kill('SIGKILL')
      const exists = (id: number) => {
        try { process.kill(id, 0); return true }
        catch (error) { if ((error as NodeJS.ErrnoException).code === 'ESRCH') return false; throw error }
      }
      await expect.poll(() => exists(pid), { timeout: 3000 }).toBe(false)
      await expect.poll(() => exists(guardian), { timeout: 3000 }).toBe(false)
    }
    finally { if (supervisor.exitCode === null && supervisor.signalCode === null) supervisor.kill('SIGKILL') }
  })
  it('rejects changed tool executable bytes before launch', async () => {
    const root = await fixture(); const file = join(root.broker, 'tool'); await writeFile(file, 'original')
    const hash = createHash('sha256').update('original').digest('hex')
    await verifyExecutable(file, hash)
    await writeFile(file, 'changed')
    await expect(verifyExecutable(file, hash)).rejects.toThrow('integrity')
  })
  it('cleans a trusted SDK host descendant even when its parent exits normally', async () => {
    const code = `const {spawn}=require('node:child_process');const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});child.unref();setTimeout(()=>{process.kill(child.pid,'SIGSTOP');console.log(child.pid);process.exit(0)},50)`
    const guardian = spawn(helper, ['supervise', process.execPath, '-e', code], { stdio: ['pipe', 'pipe', 'pipe', 'pipe', 'pipe'] })
    let output = ''; let error = ''
    guardian.stdout!.on('data', bytes => output += bytes.toString()); guardian.stderr!.on('data', bytes => error += bytes.toString())
    const codeResult = await new Promise<number | null>((resolve, reject) => { guardian.once('error', reject); guardian.once('close', resolve) })
    expect(codeResult, error).toBe(0)
    const child = Number(output.trim()); expect(child).toBeGreaterThan(1)
    await expect.poll(() => {
      try { process.kill(child, 0); return false }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error; return true }
    }).toBe(true)
  })

})
