import { spawn } from 'node:child_process'
import { hostname } from 'node:os'
import { resolve } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { shellStartupArguments, shellStdio, shellTargetHost } from '../src/shell/context.js'

afterEach(() => vi.unstubAllEnvs())

it('keeps ordinary shell defaults and makes pod startup and target selection explicit', () => {
  vi.stubEnv('APES_TARGET_HOST', undefined)
  vi.stubEnv('APES_SHELL_CLEAN_START', undefined)
  vi.stubEnv('APES_SHELL_CHANNEL_FD', undefined)
  expect(shellTargetHost()).toBe(hostname())
  expect(shellStartupArguments()).toEqual(['--login', '-i'])
  expect(shellStdio()).toBe('inherit')
  vi.stubEnv('APES_TARGET_HOST', 'pods:fixture')
  vi.stubEnv('APES_SHELL_CLEAN_START', '1')
  expect(shellTargetHost()).toBe('pods:fixture')
  expect(shellStartupArguments()).toEqual(['--noprofile', '--norc', '-i'])
})

it('rejects malformed explicit context instead of falling back to host settings', () => {
  vi.stubEnv('APES_TARGET_HOST', '')
  expect(shellTargetHost).toThrow('APES_TARGET_HOST')
  vi.stubEnv('APES_SHELL_CLEAN_START', 'false')
  expect(shellStartupArguments).toThrow('APES_SHELL_CLEAN_START')
  vi.stubEnv('APES_SHELL_CHANNEL_FD', '4')
  expect(shellStdio).toThrow('descriptor 3')
})

it('preserves an explicitly supplied protocol socket across a shell child', async () => {
  const module = resolve('src/shell/context.ts')
  const childCode = `import {execFileSync} from 'node:child_process'; import {shellStdio} from ${JSON.stringify(module)}; execFileSync(process.execPath,['-e', 'require("node:fs").writeSync(3,"protocol-preserved")'],{stdio:shellStdio()});`
  const child = spawn(process.execPath, ['--experimental-strip-types', '--input-type=module', '-e', childCode], { env: { ...process.env, APES_SHELL_CHANNEL_FD: '3' }, stdio: ['ignore', 'pipe', 'pipe', 'pipe'] })
  let output = ''; let error = ''
  child.stdio[3]!.on('data', (bytes: Buffer) => { output += bytes.toString() })
  child.stderr.on('data', (bytes: Buffer) => { error += bytes.toString() })
  const code = await new Promise<number | null>((resolve, reject) => { child.on('error', reject); child.on('close', resolve) })
  expect(code, error).toBe(0)
  expect(output).toBe('protocol-preserved')
})
