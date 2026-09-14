// @vitest-environment node
import { expect, it, vi } from 'vitest'
import { requestHttp } from '../../src/main/programs/http'

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
  for (const reply of [new Response(null, { status: 302, headers: { location: 'https://foreign.example.com' } }), new Response('x'.repeat(20001)), new Response('', { headers: { 'x-large': 'x'.repeat(31000) } })]) {
    await expect(requestHttp(request, signal, async () => reply)).rejects.toThrow('delivery may be uncertain')
  }
})
