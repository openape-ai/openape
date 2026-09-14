import { expect, it, vi } from 'vitest'
import { parseHttpRequest, parseHttpPermission } from '../../src/contracts/http'
import { requestHttp } from '../../src/main/programs/http'

it('requires an assigned HTTPS origin and method, bounds payloads and requires stable effect identities', () => {
  const permission = parseHttpPermission({ origin: 'https://api.example.invalid', methods: ['GET', 'POST'] })
  expect(parseHttpRequest({ url: 'https://api.example.invalid/items', method: 'GET' }, permission).method).toBe('GET')
  expect(() => parseHttpRequest({ url: 'https://foreign.example.invalid/items', method: 'GET' }, permission)).toThrow('assigned')
  expect(() => parseHttpRequest({ url: 'https://api.example.invalid/items', method: 'DELETE', key: 'delete:1' }, permission)).toThrow('assigned')
  expect(() => parseHttpRequest({ url: 'https://api.example.invalid/items', method: 'POST', body: '{}' }, permission)).toThrow('effect key')
  expect(() => parseHttpRequest({ url: 'https://api.example.invalid/items', method: 'POST', key: 'send:1', headers: { Host: 'foreign.example.invalid' } }, permission)).toThrow('headers')
  expect(() => parseHttpPermission({ origin: 'http://localhost', methods: ['GET'] })).toThrow('HTTPS')
  expect(() => parseHttpPermission({ origin: 'https://api.example.invalid/path', methods: ['GET'] })).toThrow('origin')
  expect(() => parseHttpRequest({ url: 'https://api.example.invalid/items', method: 'GET', body: 'x' }, permission)).toThrow('body')
})

it('does not follow redirects, passes cancellation and reports transport failures without request secrets', async () => {
  const permission = { origin: 'https://api.example.invalid', methods: ['POST'] }
  const request = parseHttpRequest({ url: 'https://api.example.invalid/botSYNTHETIC_SECRET/send', method: 'POST', key: 'mail:1', body: '{"chat_id":"synthetic"}' }, permission)
  const controller = new AbortController()
  const transport = vi.fn(async () => new Response('{"ok":true}', { status: 200, headers: { 'content-type': 'application/json' } }))
  expect(await requestHttp(request, controller.signal, transport)).toMatchObject({ status: 200, body: '{"ok":true}' })
  expect(transport.mock.calls[0]).toMatchObject([request.url, { redirect: 'error', signal: expect.any(AbortSignal) }])
  await expect(requestHttp(request, controller.signal, async () => { throw new Error(`Network failure at ${request.url}`) })).rejects.toThrow('HTTP request failed; delivery may be uncertain')
  controller.abort()
  const untouched = vi.fn()
  await expect(requestHttp(request, controller.signal, untouched)).rejects.toThrow()
  expect(untouched).not.toHaveBeenCalled()
})
