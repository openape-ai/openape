// @vitest-environment node
import { existsSync } from 'node:fs'
import { mkdtemp, realpath, rm } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import { afterEach, expect, it, vi } from 'vitest'
import type { ProgramDefinition } from '../../src/contracts/programs'
import { installation, probeOutputLimit, probeTimeoutMs, sandboxVersionProbe } from '../../src/main/programs/version-probe'
import type { launchSandbox } from '../../src/worker/runtime/sandbox'

const roots: string[] = []
afterEach(async () => { vi.useRealTimers(); for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }) })
const definition = { executable: '/opt/fixture/bin/fixture', executableHash: 'a'.repeat(64), entryFiles: [{ path: '/opt/fixture/share/entry.js', hash: 'b'.repeat(64) }], environment: { FIXTURE_MODE: 'read', NODE_OPTIONS: '--require /tmp/x.js' }, runtime: { executable: '/opt/fixture/bin/interpreter', executableHash: 'c'.repeat(64), arguments: ['-I', 'entry'], readDirectories: ['/opt/fixture/lib'], environment: { DYLD_INSERT_LIBRARIES: '/tmp/x.dylib', PYTHONPATH: '/tmp', PERL5OPT: '-Mx', RUBYOPT: '-rx', LD_PRELOAD: '/tmp/x.so', GIT_CONFIG_GLOBAL: '/tmp/x', FIXTURE_LANGUAGE: 'en' }, descriptor: { path: '/opt/fixture/runtime.json', hash: 'd'.repeat(64) } } } as unknown as ProgramDefinition

/** A sandbox launch whose process prints `output` and exits with `code`, or never exits. */
function fakeLaunch(output: string | Buffer, code: number | null) {
  const cancel = vi.fn()
  const calls: Parameters<typeof launchSandbox>[] = []
  const launch = vi.fn(async (...args: Parameters<typeof launchSandbox>) => {
    calls.push(args)
    const stdout = new PassThrough(); const stderr = new PassThrough()
    let finish!: (code: number) => void
    const completed = new Promise<number>((resolve) => { finish = resolve })
    cancel.mockImplementation(() => finish(137))
    setImmediate(() => { stdout.write(output); if (code !== null) finish(code) })
    return { stdout, stderr, completed, cancel } as unknown as Awaited<ReturnType<typeof launchSandbox>>
  })
  return { launch, calls, cancel }
}
async function scratch() { const root = await realpath(await mkdtemp(join(tmpdir(), 'pods-version-probe-'))); roots.push(root); return root }

it('probes in the isolated sandbox without network, owner HOME or code-injecting variables, in a temporary folder', async () => {
  const root = await scratch(); const fake = fakeLaunch('fixture 2.1.4\n', 0)
  expect(await sandboxVersionProbe('/fixture/helper', root, fake.launch)(definition, ['--version'])).toBe('fixture 2.1.4\n')
  const [helper, directory, policy, args, environment] = fake.calls[0]!
  expect(helper).toBe('/fixture/helper')
  expect(directory.startsWith(join(root, 'probe-'))).toBe(true)
  expect(policy).toEqual({ executable: '/opt/fixture/bin/interpreter', workspace: directory, readFiles: ['/opt/fixture/share/entry.js'], runtimeDirectories: ['/opt/fixture/lib', '/opt/fixture'], networkPorts: [] })
  expect(policy).not.toHaveProperty('reach')
  expect(args).toEqual(['-I', 'entry', '--version'])
  expect(environment).toEqual({ FIXTURE_MODE: 'read', FIXTURE_LANGUAGE: 'en', PATH: '/usr/bin:/bin', LANG: 'C', LC_ALL: 'C' })
  // The temporary folder is the probe's only writable place and is removed afterwards.
  expect(existsSync(directory)).toBe(false)
})

it('reads only the executable\'s own installation, never a system, home or package-manager root', () => {
  expect(installation('/Applications/Xcode.app/Contents/Developer/usr/bin/git')).toEqual(['/Applications/Xcode.app/Contents/Developer/usr'])
  expect(installation('/opt/homebrew/Cellar/fixture/1.0/bin/fixture')).toEqual(['/opt/homebrew/Cellar/fixture/1.0'])
  for (const executable of ['/usr/bin/git', '/opt/homebrew/bin/fixture', '/usr/local/bin/fixture', '/bin/sh']) expect(installation(executable)).toEqual([])
  expect(installation(join(homedir(), '.local/bin/fixture'))).toEqual([join(homedir(), '.local/bin')])
  expect(installation(join(homedir(), 'fixture'))).toEqual([])
})

it('returns no version for a failed command, oversized output or a timeout, and stops the process', async () => {
  const root = await scratch()
  expect(await sandboxVersionProbe('/fixture/helper', root, fakeLaunch('fixture 2.1.4\n', 1).launch)(definition, ['--version'])).toBeNull()
  const flood = fakeLaunch(Buffer.alloc(probeOutputLimit + 1, 'x'), 0)
  expect(await sandboxVersionProbe('/fixture/helper', root, flood.launch)(definition, ['--version'])).toBeNull()
  expect(flood.cancel).toHaveBeenCalled()
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  const hanging = fakeLaunch('', null)
  const pending = sandboxVersionProbe('/fixture/helper', root, hanging.launch)(definition, ['--version'])
  await vi.waitFor(() => expect(hanging.calls).toHaveLength(1))
  await vi.advanceTimersByTimeAsync(probeTimeoutMs)
  expect(await pending).toBeNull()
  expect(hanging.cancel).toHaveBeenCalled()
})
