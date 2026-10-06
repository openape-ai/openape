import { createServer } from 'node:http'
import { createApp, toNodeListener } from 'h3'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import packageJson from '../package.json'
import changelogHandler from '../server/api/changelog.get'

const getItem = vi.fn()

vi.mock('nitropack/runtime', () => ({
  useStorage: () => ({ getItem }),
}))

// The payload's `version` comes from package.json, never from the changelog
// text — so assert it against package.json rather than a literal, or every
// release breaks this test. The fixture's "## 0.1.10" heading stays
// deliberately unrelated to the real version: that mismatch is what proves
// the version is not parsed out of the text.
describe('GET /api/changelog handler', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('serves the JSON contract over HTTP', async () => {
    getItem.mockResolvedValueOnce('# @openape/troop\n\n## 0.1.10\n')
    const app = createApp()
    app.use('/api/changelog', changelogHandler)
    const server = createServer(toNodeListener(app))

    await new Promise<void>(resolve => server.listen(0, resolve))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Test server did not bind to a port')

    try {
      const response = await fetch(`http://127.0.0.1:${address.port}/api/changelog`)
      expect(response.status).toBe(200)
      expect(response.headers.get('content-type')).toBe('application/json; charset=utf-8')
      expect(response.headers.get('cache-control')).toBe('public, max-age=60')
      expect(getItem).toHaveBeenCalledWith('assets:server:CHANGELOG.md')
      await expect(response.json()).resolves.toEqual({
        service: 'openape-troop',
        version: packageJson.version,
        changelog: '# @openape/troop\n\n## 0.1.10\n',
      })
    }
    finally {
      await new Promise<void>((resolve, reject) => {
        server.close(error => error ? reject(error) : resolve())
      })
    }
  })

  it('returns HTTP 503 when the changelog asset is missing', async () => {
    getItem.mockResolvedValueOnce(undefined)
    const app = createApp()
    app.use('/api/changelog', changelogHandler)
    const server = createServer(toNodeListener(app))

    await new Promise<void>(resolve => server.listen(0, resolve))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Test server did not bind to a port')

    try {
      const response = await fetch(`http://127.0.0.1:${address.port}/api/changelog`)
      expect(response.status).toBe(503)
      await expect(response.json()).resolves.toMatchObject({
        statusCode: 503,
        statusMessage: 'Changelog unavailable',
      })
    }
    finally {
      await new Promise<void>((resolve, reject) => {
        server.close(error => error ? reject(error) : resolve())
      })
    }
  })

  it('treats an empty changelog asset as unavailable over HTTP', async () => {
    getItem.mockResolvedValueOnce('')
    const app = createApp()
    app.use('/api/changelog', changelogHandler)
    const server = createServer(toNodeListener(app))

    await new Promise<void>(resolve => server.listen(0, resolve))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Test server did not bind to a port')

    try {
      const response = await fetch(`http://127.0.0.1:${address.port}/api/changelog`)
      expect(response.status).toBe(503)
    }
    finally {
      await new Promise<void>((resolve, reject) => {
        server.close(error => error ? reject(error) : resolve())
      })
    }
  })
})
