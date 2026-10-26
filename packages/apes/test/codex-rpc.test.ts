import { createServer } from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { WebSocketServer } from 'ws'
import type { WebSocket } from 'ws'
import { connect } from '../src/codex/rpc'

const cleanup: (() => Promise<void>)[] = []
afterEach(async () => { for (const close of cleanup.splice(0)) await close() })
async function server(onRequest: (socket: WebSocket, message: Record<string, unknown>) => void) {
  const root = await mkdtemp(join(tmpdir(), 'rpc-'))
  const socket = join(root, 's')
  const http = createServer()
  const ws = new WebSocketServer({ server: http })
  ws.on('connection', client => client.on('message', (bytes) => {
    const message = JSON.parse(bytes.toString())
    if (message.method === 'initialize') client.send(JSON.stringify({ id: message.id, result: {} }))
    else if (message.method !== 'initialized') onRequest(client, message)
  }))
  await new Promise<void>(resolve => http.listen(socket, resolve))
  cleanup.push(async () => {
    for (const client of ws.clients) client.terminate()
    await new Promise<void>(resolve => ws.close(() => resolve()))
    await new Promise<void>(resolve => http.close(() => resolve()))
    await rm(root, { recursive: true, force: true })
  })
  return socket
}

it('refuses server requests and still completes the pending call', async () => {
  let refused = false
  const path = await server((socket, message) => {
    if (message.method === 'probe') {
      socket.send(JSON.stringify({ id: 'approval-1', method: 'approval/request', params: {} }))
    }
    else if (message.id === 'approval-1') {
      refused = (message.error as { code: number }).code === -32601
      socket.send(JSON.stringify({ id: 2, result: 'ok' }))
    }
  })
  const rpc = await connect(path, 2000)
  try { expect(await rpc.call('probe', {})).toBe('ok'); expect(refused).toBe(true) }
  finally { rpc.close() }
})

it('reports an unanswered call as potentially unknown', async () => {
  const path = await server(() => {})
  const rpc = await connect(path, 50)
  try { await expect(rpc.call('probe', {})).rejects.toThrow('outcome may be unknown') }
  finally { rpc.close() }
})

it.each(['closed', 'malformed'])('rejects pending calls when the transport is %s', async (mode) => {
  const path = await server((socket) => { if (mode === 'closed') socket.close(); else socket.send('not json') })
  const rpc = await connect(path, 2000)
  try { await expect(rpc.call('probe', {})).rejects.toThrow(mode === 'closed' ? 'transport closed' : 'Invalid Codex RPC') }
  finally { rpc.close() }
})

it('rejects ambiguous Unix socket URLs without connecting', async () => {
  await expect(connect('/tmp/has:colon')).rejects.toThrow('Unsupported Codex Unix socket path')
})
