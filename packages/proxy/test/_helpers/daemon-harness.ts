import type { ChildProcess } from 'node:child_process'
import { spawn } from 'node:child_process'
import { resolve } from 'node:path'

const CLI = resolve(__dirname, '../../src/index.ts')

export interface RunResult {
  code: number
  stdout: string
  stderr: string
}

export function runCliWithEnv(
  args: string[],
  stdin: string,
  envOverrides: Record<string, string> = {},
): Promise<RunResult> {
  return new Promise((resolveResult) => {
    const child = spawn(process.execPath, ['--import', 'tsx', CLI, ...args], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, ...envOverrides },
    })
    let stdout = ''
    let stderr = ''
    child.stdout!.on('data', (d) => { stdout += d.toString() })
    child.stderr!.on('data', (d) => { stderr += d.toString() })
    child.stdin!.write(stdin)
    child.stdin!.end()
    child.on('exit', code => resolveResult({ code: code ?? 0, stdout, stderr }))
  })
}

export interface DaemonHandle {
  child: ChildProcess
  port: number
  bannerStdout: string
}

const BANNER_RE = /listening on 127\.0\.0\.1:(\d+)/

export function spawnDaemonAndWaitForBanner(
  args: string[],
  stdin: string,
  envOverrides: Record<string, string> = {},
  timeoutMs = 5000,
): Promise<DaemonHandle> {
  return new Promise((resolveHandle, rejectHandle) => {
    const child = spawn(process.execPath, ['--import', 'tsx', CLI, ...args], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, ...envOverrides },
    })
    let stdout = ''
    let stderr = ''
    let settled = false
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      child.kill('SIGKILL')
      rejectHandle(new Error(`daemon banner timeout after ${timeoutMs}ms — stdout: ${stdout} stderr: ${stderr}`))
    }, timeoutMs)
    child.stdout!.on('data', (d) => {
      stdout += d.toString()
      const m = stdout.match(BANNER_RE)
      if (m && !settled) {
        settled = true
        clearTimeout(timer)
        resolveHandle({ child, port: Number.parseInt(m[1]!, 10), bannerStdout: stdout })
      }
    })
    child.stderr!.on('data', (d) => { stderr += d.toString() })
    child.on('exit', (code) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      rejectHandle(new Error(`daemon exited before banner (code=${code}) — stdout: ${stdout} stderr: ${stderr}`))
    })
    child.stdin!.write(stdin)
    child.stdin!.end()
  })
}

export function stopDaemon(handle: DaemonHandle, signal: NodeJS.Signals = 'SIGTERM'): Promise<number> {
  return new Promise((resolveExit) => {
    handle.child.once('exit', code => resolveExit(code ?? 0))
    handle.child.kill(signal)
    setTimeout(() => handle.child.kill('SIGKILL'), 2000)
  })
}
