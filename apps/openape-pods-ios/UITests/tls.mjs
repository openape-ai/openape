import { createServer } from 'node:https'
import { request as httpRequest } from 'node:http'
import { connect } from 'node:net'
import { readFile, writeFile } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { join } from 'node:path'

let generated
// One disposable CA per process: Node's fetch keeps TLS contexts from the first
// family, so a second CA would be refused as self-signed.
export async function certificate(root) {
  const path = join(root, 'ca.pem'); const keyPath = join(root, 'ca-key.pem')
  if (generated) { await writeFile(path, generated.cert); await writeFile(keyPath, generated.key); return { path, ...generated } }
  const config = join(root, 'openssl.cnf')
  await writeFile(config, '[req]\ndistinguished_name=dn\nx509_extensions=extensions\nprompt=no\n[dn]\nCN=OpenApe disposable native acceptance\n[extensions]\nbasicConstraints=critical,CA:TRUE\nkeyUsage=critical,digitalSignature,keyCertSign,keyEncipherment\nextendedKeyUsage=serverAuth\nsubjectAltName=IP:127.0.0.1\n')
  await promisify(execFile)('/usr/bin/openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-config', config, '-keyout', keyPath, '-out', path])
  generated = { cert: await readFile(path), key: await readFile(keyPath) }
  return { path, ...generated }
}

export async function tlsProxy(tls, observe = async () => {}, mobileCallback = false) {
  let target; const sockets = new Set(); const failures = []
  const server = createServer(tls, (request, response) => {
    if (!target) { response.writeHead(503).end(); return }
    const upstream = httpRequest(new URL(request.url, target), { method: request.method, headers: request.headers }, incoming => {
      const chunks = []
      incoming.on('data', chunk => chunks.push(chunk))
      incoming.on('end', () => {
        const handle = async () => {
          const body = Buffer.concat(chunks)
          await observe(request, incoming, body)
          const headers = { ...incoming.headers }
          if (mobileCallback && headers.location?.startsWith(`${origin}/mobile-auth/return?`)) {
            headers.location = `openape-pods-acceptance://callback?${new URL(headers.location).searchParams}`
          }
          response.writeHead(incoming.statusCode, headers).end(body)
        }
        void handle().catch(error => { failures.push(String(error)); response.destroy(error) })
      })
      incoming.on('error', error => { failures.push(String(error)); response.destroy(error) })
    })
    upstream.on('error', error => { failures.push(String(error)); response.destroy(error) })
    request.pipe(upstream)
  })
  server.on('connection', socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)) })
  server.on('upgrade', (request, socket, head) => {
    if (!target) { socket.destroy(); return }
    const url = new URL(target)
    const upstream = connect(Number(url.port), url.hostname, () => {
      upstream.write(`${request.method} ${request.url} HTTP/1.1\r\n${Object.entries(request.headers).map(([key, value]) => `${key}: ${value}`).join('\r\n')}\r\n\r\n`)
      if (head.length) upstream.write(head)
      socket.pipe(upstream); upstream.pipe(socket)
    })
    upstream.on('error', () => socket.destroy()); socket.on('error', () => upstream.destroy())
    socket.on('close', () => upstream.destroy())
  })
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
  const origin = `https://127.0.0.1:${server.address().port}`
  return { origin, failures, forward: url => { target = url }, close: async () => { for (const socket of sockets) socket.destroy(); await new Promise(resolve => server.close(resolve)) } }
}
