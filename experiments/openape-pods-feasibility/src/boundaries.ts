import { execFileSync, spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { closeSync, mkdirSync, mkdtempSync, openSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createProfile } from './profile.js'
import type { Observation, Probe } from './types.js'

const packageRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))
const evidenceRoot = resolve(packageRoot, '../../.openape/check-results/pods-m0')
const node = realpathSync(process.execPath)
const child = join(packageRoot, 'dist/child.js')
const native = join(packageRoot, 'dist/file-probe')

async function listener() {
  let connections = 0
  const server = createServer((socket) => { connections++; socket.end() })
  await new Promise<void>((resolveListen, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolveListen)
  })
  const address = server.address()
  if (address === null || typeof address === 'string')
    throw new Error('No loopback TCP address')
  return { server, port: address.port, connections: () => connections }
}

async function execute(command: string, args: string[], cwd: string, descriptor?: number) {
  return await new Promise<{ status: number | null, signal: string | null, stdout: string, stderr: string }>((resolveResult, reject) => {
    const processChild = spawn(command, args, {
      cwd,
      env: { PATH: '/usr/bin:/bin', LANG: 'en_US.UTF-8', TMPDIR: cwd },
      stdio: ['ignore', 'pipe', 'pipe', ...(descriptor === undefined ? [] : [...Array.from({ length: 39 }, () => 'ignore' as const), descriptor])],
    })
    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => processChild.kill('SIGKILL'), 5000)
    processChild.stdout?.on('data', (chunk) => { stdout += String(chunk) })
    processChild.stderr?.on('data', (chunk) => { stderr += String(chunk) })
    processChild.once('error', (error) => { clearTimeout(timer); reject(error) })
    processChild.once('close', (status, signal) => { clearTimeout(timer); resolveResult({ status, signal, stdout, stderr }) })
  })
}

function fixtures(root: string) {
  const workspace = join(root, 'pod-a/workspace')
  const snapshot = join(root, 'snapshots/run-a')
  const outside = join(root, 'host-home/fake-credential')
  const sibling = join(root, 'pod-b/knowledge.txt')
  const control = join(root, 'app/control.sqlite')
  for (const dir of [workspace, snapshot, join(root, 'host-home'), join(root, 'pod-b'), join(root, 'app')])
    mkdirSync(dir, { recursive: true })
  for (const file of [outside, sibling, control, join(snapshot, 'reference.txt')])
    writeFileSync(file, 'SYNTHETIC_ONLY')
  symlinkSync(outside, join(workspace, 'outside-link'))
  symlinkSync(join(snapshot, 'reference.txt'), join(workspace, 'snapshot-link'))
  return { workspace, snapshot, outside, sibling, control }
}

function probeCases(paths: ReturnType<typeof fixtures>, allowedPort: number, deniedPort: number): Probe[] {
  const { workspace, snapshot, outside, sibling, control } = paths
  const reference = join(snapshot, 'reference.txt')
  const deny = (id: string, operation: string, args: string[]): Probe => ({ id, operation, args, expected: 'deny' })
  return [
    { id: 'workspace-write', operation: 'write', args: [join(workspace, 'output.txt')], expected: 'allow' },
    { id: 'snapshot-read', operation: 'read', args: [reference], expected: 'allow' },
    { id: 'native-snapshot-read', operation: 'exec', args: [native, reference], expected: 'allow' },
    deny('host-home-read', 'read', [outside]),
    deny('sibling-pod-read', 'read', [sibling]),
    deny('control-db-read', 'read', [control]),
    deny('outside-write', 'write', [outside]),
    deny('snapshot-write', 'write', [reference]),
    deny('snapshot-chmod', 'chmod', [reference]),
    deny('snapshot-rename', 'rename', [reference, join(snapshot, 'renamed')]),
    deny('snapshot-unlink', 'unlink', [reference]),
    deny('snapshot-parent-write', 'write', [join(snapshot, 'new-file')]),
    deny('symlink-outside-read', 'read', [join(workspace, 'outside-link')]),
    deny('symlink-snapshot-write', 'write', [join(workspace, 'snapshot-link')]),
    deny('hardlink-outside', 'link', [outside, join(workspace, 'hardlink')]),
    deny('native-outside-read', 'exec', [native, outside]),
    deny('absolute-shell-read', 'exec', ['/bin/sh', '-c', 'exec /bin/cat "$1"', 'probe', outside]),
    deny('grandchild-node-read', 'exec', [node, child, 'exec', node, child, 'read', outside]),
    deny('unassigned-executable', 'exec', ['/usr/bin/id']),
    deny('copied-executable', 'copy-exec', [native, join(workspace, 'copied-native'), reference]),
    { id: 'assigned-loopback-network', operation: 'network', args: [String(allowedPort)], expected: 'allow' },
    deny('unassigned-loopback-network', 'network', [String(deniedPort)]),
    deny('inherited-sensitive-descriptor', 'descriptor', []),
    deny('clean-launch-descriptor', 'descriptor', []),
    deny('replaced-symlink-read', 'replace-symlink', [join(workspace, 'snapshot-link'), outside]),
    deny('background-grandchild-read', 'exec', ['/bin/sh', '-c', '"$1" "$2" & wait $!', 'probe', native, outside]),
  ]
}

async function observe(probeIndex: number, sandboxed: boolean, allowedPort: number, deniedPort: number) {
  const root = realpathSync(mkdtempSync(join(packageRoot, '.data/probe-')))
  let descriptor: number | undefined
  try {
    const paths = fixtures(root)
    const probes = probeCases(paths, allowedPort, deniedPort)
    const probe = probes[probeIndex]
    if (!probe)
      throw new Error('Unknown probe index')
    if (probe.operation === 'descriptor')
      descriptor = openSync(paths.outside, 'r')
    const profile = createProfile({ ...paths, node, child, native, allowedPort })
    const profileFile = join(root, 'policy.sb')
    writeFileSync(profileFile, profile)
    const args = [child, probe.operation, ...probe.args]
    const result = sandboxed
      ? await execute('/usr/bin/sandbox-exec', ['-f', profileFile, node, ...args], paths.workspace, probe.id === 'clean-launch-descriptor' ? undefined : descriptor)
      : await execute(node, args, paths.workspace, descriptor)
    return { probe, result, profile, count: probes.length }
  }
  finally {
    if (descriptor !== undefined)
      closeSync(descriptor)
    rmSync(root, { recursive: true })
  }
}

async function main(): Promise<void> {
  if (process.platform !== 'darwin')
    throw new Error('This probe requires macOS; refusing a skipped green result')
  mkdirSync(join(packageRoot, '.data'), { recursive: true })
  mkdirSync(evidenceRoot, { recursive: true })
  const [allowed, denied] = await Promise.all([listener(), listener()])
  const observations: Observation[] = []
  try {
    let count = 1
    for (let index = 0; index < count; index++) {
      const control = await observe(index, false, allowed.port, denied.port)
      count = control.count
      const sandbox = await observe(index, true, allowed.port, denied.port)
      const started = sandbox.result.stderr.includes(`PROBE_STARTED:${sandbox.probe.operation}`)
      const denial = sandbox.probe.id === 'clean-launch-descriptor' ? /EBADF/ : /permitted|EACCES|EPERM|Permission denied/i
      const deniedByPolicy = started && sandbox.result.status !== null && sandbox.result.status !== 0 && denial.test(sandbox.result.stderr)
      const matches = control.probe.expected === 'allow' ? sandbox.result.status === 0 : deniedByPolicy
      const status = control.result.status !== 0 ? 'UNVERIFIED' : matches ? 'PASS' : 'FAIL'
      const observation: Observation = {
        id: control.probe.id,
        expected: control.probe.expected,
        status,
        controlExit: control.result.status,
        sandboxExit: sandbox.result.status,
        sandboxSignal: sandbox.result.signal,
        stdout: sandbox.result.stdout.trim(),
        stderr: sandbox.result.stderr.trim().replaceAll(packageRoot, '<experiment>'),
      }
      observations.push(observation)
      process.stdout.write(`${status} ${observation.id}: control=${observation.controlExit} sandbox=${observation.sandboxExit}\n`)
      writeFileSync(join(evidenceRoot, 'last-policy.sb'), sandbox.profile)
    }
  }
  finally {
    await Promise.all([allowed, denied].map(async ({ server }) => {
      await new Promise<void>((resolveClose, reject) => server.close(error => error ? reject(error) : resolveClose()))
    }))
  }
  const report = {
    generatedAt: new Date().toISOString(),
    os: execFileSync('/usr/bin/sw_vers', [], { encoding: 'utf8' }).trim(),
    architecture: process.arch,
    node: process.version,
    nodeSha256: createHash('sha256').update(readFileSync(node)).digest('hex'),
    nativeSha256: createHash('sha256').update(readFileSync(native)).digest('hex'),
    scope: 'M0a development sandbox-exec experiment, synthetic resources only; not a production enforcement proof',
    allowedConnections: allowed.connections(),
    deniedEndpointConnections: denied.connections(),
    observations,
  }
  writeFileSync(join(evidenceRoot, 'boundaries.json'), `${JSON.stringify(report, null, 2)}\n`)
  if (observations.some(row => row.status !== 'PASS'))
    process.exitCode = 1
}

void main().catch((error: unknown) => {
  console.error(error)
  process.exitCode = 1
})
