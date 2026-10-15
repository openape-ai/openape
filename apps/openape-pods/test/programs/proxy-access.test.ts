// @vitest-environment node
import { request as httpRequest } from 'node:http'
import { afterEach, expect, it } from 'vitest'
import { startNetworkProxy } from '../../src/main/network/proxy'

let proxy: Awaited<ReturnType<typeof startNetworkProxy>> | undefined
afterEach(async () => { await proxy?.close(); proxy = undefined })
it('rejects anonymous and foreign CONNECT targets before opening any upstream', async () => {
  proxy = await startNetworkProxy(new AbortController().signal, ['graph.microsoft.com', 'login.microsoftonline.com'])
  for (const [path, authorization] of [['graph.microsoft.com:443', ''], ['unassigned.invalid:443', `Basic ${Buffer.from(`${new URL(proxy.environment.HTTPS_PROXY).username}:${new URL(proxy.environment.HTTPS_PROXY).password}`).toString('base64')}`]]) {
    const status = await new Promise<number>((resolve, reject) => {
      const call = httpRequest({ host: '127.0.0.1', port: proxy!.port, method: 'CONNECT', path, headers: { 'Proxy-Authorization': authorization } })
      call.on('connect', (response, socket) => { socket.destroy(); resolve(response.statusCode!) }); call.on('error', reject); call.end()
    })
    expect(status).toBe(403)
  }
})
