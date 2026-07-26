import { createServer } from 'node:http'
import { createApp, toNodeListener } from 'h3'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { H3Event } from 'h3'
import { buildChangelogPayload } from '../server/utils/changelog'
import changelogHandler from '../server/api/changelog.get'

const getItem = vi.fn()

vi.mock('nitropack/runtime', () => ({
  useStorage: () => ({ getItem }),
}))

describe('GET /api/changelog payload', () => {
  it('returns the Troop version and the complete changelog text', () => {
    const payload = buildChangelogPayload('# @openape/troop\n\n## 0.1.10\n')

    expect(payload).toEqual({
      service: 'openape-troop',
      version: '0.1.10',
      changelog: '# @openape/troop\n\n## 0.1.10\n',
    })
  })

  it('keeps an empty changelog as valid text', () => {
    expect(buildChangelogPayload('').changelog).toBe('')
  })
})

describe('GET /api/changelog handler', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  function event() {
    return {
      node: { res: { setHeader: vi.fn() } },
    } as unknown as H3Event
  }

  it('returns the payload and response headers from the handler', async () => {
    getItem.mockResolvedValueOnce('# @openape/troop\n\n## 0.1.10\n')
    const request = event()

    await expect(changelogHandler(request)).resolves.toEqual({
      service: 'openape-troop',
      version: '0.1.10',
      changelog: '# @openape/troop\n\n## 0.1.10\n',
    })
    expect(getItem).toHaveBeenCalledWith('assets:server:CHANGELOG.md')
    expect(request.node.res.setHeader).toHaveBeenCalledWith('cache-control', 'public, max-age=60')
    expect(request.node.res.setHeader).toHaveBeenCalledWith('content-type', 'application/json; charset=utf-8')
  })

  it('returns a service-unavailable error when the asset is missing', async () => {
    getItem.mockResolvedValueOnce(undefined)

    await expect(changelogHandler(event())).rejects.toMatchObject({
      statusCode: 503,
      statusMessage: 'Changelog unavailable',
    })
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
      await expect(response.json()).resolves.toEqual({
        service: 'openape-troop',
        version: '0.1.10',
        changelog: '# @openape/troop\n\n## 0.1.10\n',
      })
    }
    finally {
      await new Promise<void>((resolve, reject) => {
        server.close(error => error ? reject(error) : resolve())
      })
    }
  })
})
