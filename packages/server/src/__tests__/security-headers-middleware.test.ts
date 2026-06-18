import { createApp, eventHandler, toNodeListener } from 'h3'
import { createServer } from 'node:http'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createSecurityHeadersMiddleware } from '../idp/middleware/security-headers.js'

describe('createSecurityHeadersMiddleware', () => {
  let server: ReturnType<typeof createServer>
  let baseUrl: string

  beforeAll(async () => {
    const app = createApp()
    app.use(createSecurityHeadersMiddleware())
    app.use('/default', eventHandler(() => ({ ok: true })))
    app.use('/override', eventHandler((event) => {
      event.node.res.setHeader('Content-Security-Policy', 'default-src \'self\'')
      event.node.res.setHeader('Cache-Control', 'public, max-age=60')
      return { ok: true }
    }))
    app.use('/partial-override', eventHandler((event) => {
      event.node.res.setHeader('X-Frame-Options', 'SAMEORIGIN')
      return { ok: true }
    }))

    server = createServer(toNodeListener(app))
    await new Promise<void>(resolve => server.listen(0, resolve))
    const address = server.address()
    if (!address || typeof address === 'string') {
      throw new TypeError('Expected server to listen on a TCP port')
    }
    baseUrl = `http://127.0.0.1:${address.port}`
  })

  afterAll(() => {
    server.close()
  })

  it('sets the full default header set', async () => {
    const response = await fetch(`${baseUrl}/default`)

    expect(response.headers.get('x-content-type-options')).toBe('nosniff')
    expect(response.headers.get('x-frame-options')).toBe('DENY')
    expect(response.headers.get('content-security-policy')).toBe('frame-ancestors \'none\'')
    expect(response.headers.get('x-xss-protection')).toBe('0')
    expect(response.headers.get('referrer-policy')).toBe('strict-origin-when-cross-origin')
    expect(response.headers.get('cache-control')).toBe('no-store')
  })

  it('lets downstream handlers override defaults when needed', async () => {
    const response = await fetch(`${baseUrl}/override`)

    expect(response.headers.get('content-security-policy')).toBe('default-src \'self\'')
    expect(response.headers.get('cache-control')).toBe('public, max-age=60')
    expect(response.headers.get('x-frame-options')).toBe('DENY')
    expect(response.headers.get('x-content-type-options')).toBe('nosniff')
  })

  it('preserves unrelated defaults when only one header is overridden', async () => {
    const response = await fetch(`${baseUrl}/partial-override`)

    expect(response.headers.get('x-frame-options')).toBe('SAMEORIGIN')
    expect(response.headers.get('content-security-policy')).toBe('frame-ancestors \'none\'')
    expect(response.headers.get('cache-control')).toBe('no-store')
  })
})
