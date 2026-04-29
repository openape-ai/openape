import { spawn } from 'node:child_process'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const CLI = resolve(__dirname, '../src/index.ts')

function runCli(args: string[], stdin = ''): Promise<{ code: number, stdout: string, stderr: string }> {
  return new Promise((resolveResult) => {
    // Use bun (workspace-standard runner; package start/dev scripts use it) to
    // execute the TypeScript entrypoint directly. tsx via node would also work,
    // but bun avoids depending on workspace-root tsx hoisting.
    const child = spawn('bun', ['run', CLI, ...args], {
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (d) => { stdout += d.toString() })
    child.stderr.on('data', (d) => { stderr += d.toString() })
    child.stdin.write(stdin)
    child.stdin.end()
    child.on('exit', code => resolveResult({ code: code ?? 0, stdout, stderr }))
  })
}

describe('daemon CLI', () => {
  it('refuses --global with empty stdin', async () => {
    const r = await runCli(['--global', '--port', '0'], '')
    expect(r.code).not.toBe(0)
    expect(r.stderr).toMatch(/stdin|secrets/i)
  }, 15000)

  it('refuses --global with invalid TOML', async () => {
    const r = await runCli(['--global', '--port', '0'], 'this is not toml = = =')
    expect(r.code).not.toBe(0)
  }, 15000)

  it('accepts --global with valid secrets TOML on stdin', async () => {
    const blob = `version = "1"

[secrets.test_key]
target = "api.example.com"
header = "Authorization"
template = "Bearer {{value}}"
value = "secret123"
`
    const r = await runCli(['--global', '--port', '0'], blob)
    expect(r.code).toBe(0)
    expect(r.stdout).toMatch(/loaded 1 secrets.*test_key/)
  }, 15000)
})
