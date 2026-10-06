import { describe, expect, it } from 'vitest'
import plugin from '../src/runtime/server/plugins/problem-details'

interface Captured {
  ended: boolean
  body: string
  status: number
  headers: Record<string, string>
}

/** Fires the nitro `error` hook with the given request headers and records what the response got. */
function fireError(error: unknown, headers: Record<string, string>): Captured {
  let hook: (err: unknown, ctx: { event: unknown }) => void = () => {}
  plugin({ hooks: { hook: (_name: string, fn: typeof hook) => { hook = fn } } } as never)

  const captured: Captured = { ended: false, body: '', status: 0, headers: {} }
  const event = {
    node: {
      req: { headers },
      res: {
        statusCode: 0,
        setHeader: (k: string, v: string) => { captured.headers[k.toLowerCase()] = v },
        end: (b: string) => { captured.ended = true; captured.body = b ?? '' },
      },
    },
  }
  hook(error, { event })
  captured.status = event.node.res.statusCode
  return captured
}

const BROWSER = { 'accept': 'text/html,*/*;q=0.8', 'sec-fetch-mode': 'navigate' }
const notFound = { statusCode: 404, statusMessage: 'Page not found: /nope' }

describe('problem-details nitro hook', () => {
  it('leaves a browser navigation to the framework error page', () => {
    // The hook used to end EVERY error response as JSON, so Nuxt never got to
    // render error.vue and a browser was shown a raw problem+json document.
    const res = fireError(notFound, BROWSER)
    expect(res.ended).toBe(false)
    expect(res.body).not.toContain('about:blank')
  })

  it('still answers an API client with problem+json', () => {
    const res = fireError(notFound, { accept: 'application/json' })
    expect(res.ended).toBe(true)
    expect(res.headers['content-type']).toBe('application/problem+json')
    expect(JSON.parse(res.body)).toMatchObject({ type: 'about:blank', status: 404 })
  })

  it('still answers a client sending no Accept header with problem+json', () => {
    expect(fireError(notFound, {}).headers['content-type']).toBe('application/problem+json')
  })

  it('keeps an RFC 7807 error from createProblemError intact for API clients', () => {
    const problem = { data: { type: 'https://openape.ai/errors/no-grant', status: 403, title: 'No grant' } }
    const res = fireError(problem, { accept: 'application/json' })
    expect(JSON.parse(res.body)).toMatchObject({ status: 403, title: 'No grant' })
  })

  it('does not swallow a createProblemError for a browser either', () => {
    const problem = { data: { type: 'https://openape.ai/errors/no-grant', status: 403, title: 'No grant' } }
    expect(fireError(problem, BROWSER).ended).toBe(false)
  })
})
