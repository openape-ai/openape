import { randomBytes, timingSafeEqual } from 'node:crypto'
import { createServer } from 'node:http'
import { connect } from 'node:net'
import type { Socket } from 'node:net'

export async function startMailProxy(signal: AbortSignal, dial: (host: string) => Socket = host => connect({ host, port: 443 })) {
  signal.throwIfAborted()
  const secret = randomBytes(32).toString('hex')
  const expected = Buffer.from(`Basic ${Buffer.from(`pods:${secret}`).toString('base64')}`)
  const sockets = new Set<Socket>()
  let bytes = 0
  const server = createServer((_request, response) => { response.writeHead(405); response.end() })
  const stop = () => { for (const socket of sockets) socket.destroy() }
  server.on('connect', (request, socket, head) => {
    const authorization = Buffer.from(request.headers['proxy-authorization'] ?? '')
    if (signal.aborted || authorization.length !== expected.length || !timingSafeEqual(authorization, expected) || request.headers.origin || !['graph.microsoft.com:443', 'login.microsoftonline.com:443'].includes(request.url ?? '') || sockets.size >= 8 || head.length) { socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'); return }
    const upstream = dial(request.url!.split(':')[0])
    sockets.add(socket as Socket); sockets.add(upstream)
    const close = () => { socket.destroy(); upstream.destroy(); sockets.delete(socket as Socket); sockets.delete(upstream) }
    for (const stream of [socket as Socket, upstream]) {
      stream.on('error', close); stream.on('close', close); stream.setTimeout(30000, close)
      stream.on('data', (chunk: Buffer) => { bytes += chunk.length; if (bytes > 64 * 1024 * 1024) stop() })
    }
    upstream.once('connect', () => { socket.write('HTTP/1.1 200 Connection Established\r\n\r\n'); socket.pipe(upstream); upstream.pipe(socket) })
  })
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
  signal.addEventListener('abort', stop, { once: true })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Mail network broker did not bind')
  return { port: address.port, environment: { HTTPS_PROXY: `http://pods:${secret}@127.0.0.1:${address.port}`, HTTP_PROXY: '', NO_PROXY: '' }, close: async () => { signal.removeEventListener('abort', stop); stop(); server.closeAllConnections(); await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())) } }
}
