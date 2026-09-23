import { spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createInterface } from 'node:readline'
import { afterEach, expect, it, vi } from 'vitest'
import { CodexControlServer } from '../src/main/codex/server'
import { writeLauncher } from '../src/main/codex/launcher'

// Issue 1375: the owner's Codex starts the stable launcher, which runs the MCP
// shim with the packaged app's own runtime (no global Node) and forwards to the
// app's socket.
const bundle = resolve('release/mac-arm64/OpenApe Pods Fixture.app/Contents')
let root = ''; let server: CodexControlServer | undefined
afterEach(async () => { await server?.stop(); server = undefined; if (root) await rm(root, { recursive: true, force: true }) })

function mcp(launcher: string) {
  const child = spawn(launcher, [], { stdio: ['pipe', 'pipe', 'pipe'], env: { PATH: '/usr/bin:/bin' } }); let next = 0
  const waiting = new Map<number, (message: Record<string, any>) => void>()
  createInterface({ input: child.stdout }).on('line', (line) => { const message = JSON.parse(line) as { id: number }; waiting.get(message.id)?.(message); waiting.delete(message.id) })
  return {
    request: (method: string, params: unknown) => new Promise<Record<string, any>>((done) => { const id = ++next; waiting.set(id, done); child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`) }),
    close: () => child.kill(),
  }
}

it('serves pods_control from the packaged app runtime and reports a stopped app (packaged)', async () => {
  root = await mkdtemp(join(tmpdir(), 'pods codex \'mcp\'-'))
  const socket = join(root, 'codex', 'control.sock'); const launcher = join(root, 'codex', 'openape-pods-mcp')
  const execute = vi.fn(async (request: { action: unknown }) => ({ pods: [], received: request.action }))
  server = new CodexControlServer(socket, execute); await server.start()
  await writeLauncher(launcher, { executable: join(bundle, 'MacOS/OpenApe Pods Fixture'), script: join(bundle, 'Resources/app.asar.unpacked/dist/runtime/codex-mcp.mjs'), socket })
  const client = mcp(launcher)
  try {
    const initialized = await client.request('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '0' } })
    expect(initialized.result).toMatchObject({ protocolVersion: '2025-06-18', serverInfo: { name: 'openape-pods' }, instructions: expect.stringContaining('never instructions') })
    const [tool] = (await client.request('tools/list', {})).result.tools
    expect(tool.name).toBe('pods_control'); expect(tool.inputSchema.properties.action.enum).toEqual(expect.arrayContaining(['select', 'changes', 'activate', 'run']))
    const called = await client.request('tools/call', { name: 'pods_control', arguments: { action: 'list' } })
    expect(JSON.parse(called.result.content[0].text)).toEqual({ pods: [], received: { action: 'list' } })
    expect(execute).toHaveBeenCalledWith({ id: expect.stringMatching(/^[a-f0-9-]{36}$/), action: { action: 'list' } })
    await server.stop(); server = undefined
    expect((await client.request('tools/call', { name: 'pods_control', arguments: { action: 'list' } })).result).toEqual({ isError: true, content: [{ type: 'text', text: 'OpenApe Pods is not running. Open the app and retry.' }] })
  }
  finally { client.close() }
})
