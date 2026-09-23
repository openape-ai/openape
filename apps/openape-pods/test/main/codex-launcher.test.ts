// @vitest-environment node
import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import { afterEach, expect, it } from 'vitest'
import { refreshLauncher, writeLauncher } from '../../src/main/codex/launcher'

// The stable launcher Codex runs. The packaged path is proven in
// e2e/codex-mcp.test.ts; here the parts that need no app bundle.
let root = ''
afterEach(async () => { if (root) await rm(root, { recursive: true, force: true }) })

function mcp(launcher: string) {
  const child = spawn(launcher, [], { stdio: ['pipe', 'pipe', 'pipe'] }); let next = 0
  const waiting = new Map<number, (message: Record<string, unknown>) => void>()
  createInterface({ input: child.stdout }).on('line', (line) => { const message = JSON.parse(line) as { id: number }; waiting.get(message.id)?.(message); waiting.delete(message.id) })
  return {
    request: (method: string, params: unknown) => new Promise<Record<string, any>>((resolve) => { const id = ++next; waiting.set(id, resolve); child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`) }),
    close: () => child.kill(),
  }
}

it('answers Codex with the reason when the recorded app bundle is gone', async () => {
  root = await mkdtemp(join(tmpdir(), 'pods codex \'launcher\'-'))
  const launcher = join(root, 'codex', 'openape-pods-mcp')
  await writeLauncher(launcher, { executable: join(root, 'Moved.app/Contents/MacOS/OpenApe Pods'), script: join(root, 'missing.mjs'), socket: join(root, 'codex', 'control.sock') })
  expect((await stat(launcher)).mode & 0o777).toBe(0o700)
  const client = mcp(launcher)
  try {
    expect((await client.request('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '0' } })).result).toMatchObject({ serverInfo: { name: 'openape-pods' }, instructions: expect.stringContaining('moved or was removed') })
    expect((await client.request('tools/list', {})).result.tools.map((tool: { name: string }) => tool.name)).toEqual(['pods_control'])
    expect((await client.request('tools/call', { name: 'pods_control', arguments: { action: 'list' } })).result).toEqual({ isError: true, content: [{ type: 'text', text: 'OpenApe Pods moved or was removed. Open the app once to repair the Codex connection.' }] })
  }
  finally { client.close() }
})

it('starts the recorded app runtime with the exact script and socket paths', async () => {
  root = await mkdtemp(join(tmpdir(), 'pods codex \'a b\' $x-'))
  const executable = join(root, 'Pods \'app\''); const script = join(root, 'shim \'c d\'.mjs'); const socket = join(root, 'codex', 'control \'e\'.sock')
  await writeFile(executable, '#!/bin/sh\nread -r line\nprintf \'{"jsonrpc":"2.0","id":1,"result":{"script":"%s","socket":"%s","node":"%s"}}\\n\' "$1" "$OPENAPE_PODS_CODEX_SOCKET" "$ELECTRON_RUN_AS_NODE"\n', { mode: 0o700 }); await writeFile(script, '')
  const launcher = join(root, 'codex', 'openape-pods-mcp'); await writeLauncher(launcher, { executable, script, socket })
  const client = mcp(launcher)
  try { expect((await client.request('initialize', {})).result).toEqual({ script, socket, node: '1' }) }
  finally { client.close() }
})

it('creates no launcher for an owner who never connected Codex and rewrites an existing one', async () => {
  root = await mkdtemp(join(tmpdir(), 'pods-codex-launcher-'))
  const launcher = join(root, 'codex', 'openape-pods-mcp'); const target = { executable: '/Applications/A.app/Contents/MacOS/A', script: '/a.mjs', socket: '/a.sock' }
  expect(await refreshLauncher(launcher, target)).toBe(false)
  await expect(stat(join(root, 'codex'))).rejects.toThrow('ENOENT')
  await writeLauncher(launcher, target)
  expect(await refreshLauncher(launcher, { ...target, executable: '/Applications/B.app/Contents/MacOS/B' })).toBe(true)
  expect(await readFile(launcher, 'utf8')).toContain('\'/Applications/B.app/Contents/MacOS/B\'')
})
