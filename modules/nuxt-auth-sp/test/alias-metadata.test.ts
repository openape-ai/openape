import { createServer } from 'node:http'
import { createApp, toNodeListener } from 'h3'
import { afterEach, expect, it, vi } from 'vitest'

const config = { openapeSp: { clientId: 'testrun.openape.ai', spName: 'Reports', additionalRedirectUris: [] as string[] } }
vi.mock('nitropack/runtime', () => ({ useRuntimeConfig: () => config }))
const { default: handler } = await import('../src/runtime/server/routes/well-known/oauth-client-metadata.get')
let server: ReturnType<typeof createServer>
afterEach(async () => { if (server) await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())) })
it('publishes only explicitly configured alias callbacks without changing the client identity', async () => {
  config.openapeSp.additionalRedirectUris = ['https://report.openape.ai/api/callback', 'https://report.openape.ai/oauth/grants/callback']
  server = createServer(toNodeListener(createApp().use(handler)))
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as { port: number }).port
  const response = await fetch(`http://127.0.0.1:${port}`)
  expect(await response.json()).toMatchObject({ client_id: 'testrun.openape.ai', redirect_uris: [`http://127.0.0.1:${port}/api/callback`, ...config.openapeSp.additionalRedirectUris, `http://127.0.0.1:${port}/oauth/grants/callback`] })
})
it('rejects configured callbacks containing credentials or fragments', async () => {
  config.openapeSp.additionalRedirectUris = ['https://user:secret@report.openape.ai/api/callback']
  server = createServer(toNodeListener(createApp().use(handler)))
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as { port: number }).port
  expect((await fetch(`http://127.0.0.1:${port}`)).status).toBe(500)
})
