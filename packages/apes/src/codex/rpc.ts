import { WebSocket } from 'ws'
import type { Rpc } from './contract'

export async function connect(socketPath: string, timeoutMs = 15000): Promise<Rpc> {
  if (!socketPath.startsWith('/') || /[:\n\r\0]/.test(socketPath)) throw new Error('Unsupported Codex Unix socket path')
  const socket = new WebSocket(`ws+unix://${socketPath}:/`, { maxPayload: 8 * 1024 * 1024 })
  let serial = 0
  const pending = new Map<number, { resolve: (value: unknown) => void, reject: (error: Error) => void }>()
  const fail = (message: string) => {
    for (const waiter of pending.values()) waiter.reject(new Error(message))
    pending.clear()
  }
  socket.on('error', error => fail(`Codex transport: ${error.message}`))
  socket.on('close', () => fail('Codex transport closed; dispatched requests may have been accepted'))
  socket.on('message', (raw) => {
    try {
      const message = JSON.parse(raw.toString())
      if (message.method && message.id !== undefined) {
        socket.send(JSON.stringify({ id: message.id, error: { code: -32601, message: 'Unattended handoff does not support client requests' } }))
        return
      }
      const waiter = pending.get(message.id)
      if (!waiter) return
      pending.delete(message.id)
      if (message.error) waiter.reject(new Error(`Codex RPC ${message.error.code}: ${String(message.error.message).slice(0, 500)}`))
      else waiter.resolve(message.result)
    }
    catch { fail('Invalid Codex RPC response') }
  })
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Codex connection deadline exceeded')), timeoutMs)
      socket.once('open', () => { clearTimeout(timer); resolve() })
      socket.once('error', (error) => { clearTimeout(timer); reject(error) })
    })
    const rpc: Rpc = {
      call(method, params) {
        return new Promise((resolve, reject) => {
          const id = ++serial
          const timer = setTimeout(() => {
            pending.delete(id)
            reject(new Error(`Codex ${method} deadline exceeded; outcome may be unknown`))
          }, timeoutMs)
          pending.set(id, {
            resolve: (value) => { clearTimeout(timer); resolve(value) },
            reject: (error) => { clearTimeout(timer); reject(error) },
          })
          socket.send(JSON.stringify({ id, method, params }), (error) => {
            if (error) { pending.delete(id); clearTimeout(timer); reject(error) }
          })
        })
      },
      close() { socket.terminate() },
    }
    await rpc.call('initialize', { clientInfo: { name: 'openape_codex_handoff', version: '1.0.0' }, capabilities: { experimentalApi: true } })
    socket.send(JSON.stringify({ method: 'initialized', params: {} }))
    return rpc
  }
  catch (error) { socket.terminate(); throw error }
}
