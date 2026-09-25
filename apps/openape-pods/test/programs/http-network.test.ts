import { request as httpRequest } from 'node:http'
import { startMailProxy } from '../../src/main/mail/proxy'
// @vitest-environment node
import { expect, it, vi } from 'vitest'
import { requestHttp } from '../../src/main/programs/http'
import { httpResponseBodyBytes } from '../../src/contracts/http'

const lookup = vi.hoisted(() => vi.fn())
vi.mock('node:dns/promises', () => ({ lookup }))
const request = { url: 'https://api.example.com/send', method: 'POST', headers: {}, key: 'synthetic' }
it.each(['127.0.0.1', '10.0.0.1', '172.16.0.1', '192.168.0.1', '169.254.169.254', '100.64.0.1', '224.0.0.1'])('rejects a public hostname that resolves to %s before connecting', async (address) => {
  lookup.mockResolvedValue([{ address, family: 4 }])
  await expect(requestHttp(request, new AbortController().signal)).rejects.toThrow('delivery may be uncertain')
  expect(lookup).toHaveBeenLastCalledWith('api.example.com', { family: 4, all: true })
})
it('rejects redirects, oversized bodies and oversized headers from a transport', async () => {
  const signal = new AbortController().signal
  for (const reply of [new Response(null, { status: 302, headers: { location: 'https://foreign.example.com' } }), new Response('x'.repeat(httpResponseBodyBytes + 1)), new Response('', { headers: { 'x-large': 'x'.repeat(200 * 1024) } })]) {
    await expect(requestHttp(request, signal, async () => reply)).rejects.toThrow('delivery may be uncertain')
  }
})

it('rejects a private DNS result behind an allowed application proxy hostname', async () => {
  lookup.mockResolvedValue([{ address: '127.0.0.1', family: 4 }])
  const proxy = await startMailProxy(new AbortController().signal, undefined, ['api.example.com'])
  try {
    const address = new URL(proxy.environment.HTTPS_PROXY)
    const authorization = `Basic ${Buffer.from(`${address.username}:${address.password}`).toString('base64')}`
    const status = await new Promise<number>((resolve, reject) => {
      const request = httpRequest({ host: '127.0.0.1', port: proxy.port, method: 'CONNECT', path: 'api.example.com:443', headers: { 'Proxy-Authorization': authorization } })
      request.on('connect', (response, socket) => { socket.destroy(); resolve(response.statusCode!) })
      request.on('error', reject); request.end()
    })
    expect(status).toBe(502)
    expect(lookup).toHaveBeenLastCalledWith('api.example.com', { family: 4, all: true })
  }
  finally { await proxy.close() }
})
