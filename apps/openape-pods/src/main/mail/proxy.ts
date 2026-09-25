import { publicHttpsAddresses } from '../programs/http'
import { parseNetworkHosts } from '../../contracts/programs'
import { randomBytes, timingSafeEqual } from 'node:crypto'
import { createServer } from 'node:http'
import { connect } from 'node:net'
import type { Socket } from 'node:net'

async function dialPublicHost(host: string): Promise<Socket> {
  const addresses = await publicHttpsAddresses(host)
  return connect({ host: addresses[0].address, port: 443 })
}

export async function startMailProxy(signal: AbortSignal, dial: (host: string) => Socket | Promise<Socket> = dialPublicHost, hosts: string[] = ['graph.microsoft.com', 'login.microsoftonline.com']) {
  signal.throwIfAborted()
  const allowed = parseNetworkHosts(hosts)
  const secret = randomBytes(32).toString('hex')
  const expected = Buffer.from(`Basic ${Buffer.from(`pods:${secret}`).toString('base64')}`)
  const sockets = new Set<Socket>()
  let bytes = 0
  const server = createServer((_request, response) => { response.writeHead(405); response.end() })
  const stop = () => { for (const socket of sockets) socket.destroy() }
  server.on('connect', (request, socket, head) => {
    socket.on('error', () => { sockets.delete(socket as Socket); socket.destroy() })
    const establish = async () => {
      const authorization = Buffer.from(request.headers['proxy-authorization'] ?? '')
      if (signal.aborted || authorization.length !== expected.length || !timingSafeEqual(authorization, expected) || request.headers.origin || !allowed.map(host => `${host}:443`).includes(request.url ?? '') || sockets.size >= 8 || head.length) { socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'); return }
      sockets.add(socket as Socket)
      const upstream = await dial(request.url!.split(':')[0])
      if (signal.aborted || socket.destroyed) { upstream.destroy(); sockets.delete(socket as Socket); return }
      sockets.add(upstream)
      const close = () => { socket.destroy(); upstream.destroy(); sockets.delete(socket as Socket); sockets.delete(upstream) }
      for (const stream of [socket as Socket, upstream]) {
        stream.on('error', close); stream.on('close', close); stream.setTimeout(30000, close)
        stream.on('data', (chunk: Buffer) => { bytes += chunk.length; if (bytes > 64 * 1024 * 1024) stop() })
      }
      upstream.once('connect', () => { socket.write('HTTP/1.1 200 Connection Established\r\n\r\n'); socket.pipe(upstream); upstream.pipe(socket) })
    }
    void establish().catch(() => { sockets.delete(socket as Socket); socket.end('HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n') })
  })
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
  signal.addEventListener('abort', stop, { once: true })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Mail network broker did not bind')
  return { port: address.port, environment: { HTTPS_PROXY: `http://pods:${secret}@127.0.0.1:${address.port}`, HTTP_PROXY: '', NO_PROXY: '' }, close: async () => { signal.removeEventListener('abort', stop); stop(); server.closeAllConnections(); await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())) } }
}
