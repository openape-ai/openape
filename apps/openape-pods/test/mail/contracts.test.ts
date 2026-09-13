// @vitest-environment node
import { request as httpRequest } from 'node:http'
import { afterEach, expect, it } from 'vitest'
import { parseMailRequest } from '../../src/main/mail/contract'
import { startMailProxy } from '../../src/main/mail/proxy'

const scope = { account: 'pod@example.invalid', folders: ['inbox', 'sentitems', 'rules'], attachments: false }
const request = { toolId: 'o365-mail', argv: ['o365-cli', 'pods', 'read', '--operation', 'messages', '--account', scope.account, '--folder', 'inbox'] }
it('binds read commands to the exact account, folder and attachment permission', () => {
  expect(parseMailRequest(request, scope).read).toEqual({ operation: 'messages', folder: 'inbox' })
  for (const argv of [request.argv.map(value => value === 'inbox' ? 'foreign' : value), request.argv.map(value => value === scope.account ? 'other@example.invalid' : value), [...request.argv, '--cache-dir', '/tmp/stolen'], [...request.argv, '--folder', 'sentitems'], request.argv.map(value => value === 'messages' ? 'send' : value), [...request.argv.map(value => value === 'messages' ? 'attachments' : value), '--message', 'm1']]) {
    expect(() => parseMailRequest({ ...request, argv }, scope)).toThrow()
  }
})
let proxy: Awaited<ReturnType<typeof startMailProxy>> | undefined
afterEach(async () => { await proxy?.close(); proxy = undefined })
it('rejects anonymous and foreign CONNECT targets before opening any upstream', async () => {
  proxy = await startMailProxy(new AbortController().signal)
  for (const [path, authorization] of [['graph.microsoft.com:443', ''], ['unassigned.invalid:443', `Basic ${Buffer.from(`${new URL(proxy.environment.HTTPS_PROXY).username}:${new URL(proxy.environment.HTTPS_PROXY).password}`).toString('base64')}`]]) {
    const status = await new Promise<number>((resolve, reject) => {
      const call = httpRequest({ host: '127.0.0.1', port: proxy!.port, method: 'CONNECT', path, headers: { 'Proxy-Authorization': authorization } })
      call.on('connect', (response, socket) => { socket.destroy(); resolve(response.statusCode!) }); call.on('error', reject); call.end()
    })
    expect(status).toBe(403)
  }
})
it('requires the exact history filter on message reads and keeps attachment filtering out of CLI arguments', () => {
  const bounded = { ...scope, since: '2026-06-01T00:00:00Z', attachments: true }
  expect(() => parseMailRequest(request, bounded)).toThrow('history')
  expect(parseMailRequest({ ...request, argv: [...request.argv, '--since', bounded.since] }, bounded).read.operation).toBe('messages')
  expect(() => parseMailRequest({ ...request, argv: [...request.argv, '--since', '2026-05-01T00:00:00Z'] }, bounded)).toThrow('history')
  const attachments = [...request.argv.map(value => value === 'messages' ? 'attachments' : value), '--message', 'm1']
  expect(parseMailRequest({ ...request, argv: attachments }, bounded).read.message).toBe('m1')
  expect(() => parseMailRequest({ ...request, argv: [...attachments, '--since', bounded.since] }, bounded)).toThrow('history')
})
