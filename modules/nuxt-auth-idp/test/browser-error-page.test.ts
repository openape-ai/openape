import { afterEach, describe, expect, it, vi } from 'vitest'
import problemDetailsPlugin from '../src/runtime/server/plugins/problem-details'
import rateLimitPlugin from '../src/runtime/server/plugins/rate-limit'
import { renderErrorPage, wantsHtmlErrorPage } from '../src/runtime/server/utils/error-page'

vi.mock('h3', async () => {
  const actual = await vi.importActual<any>('h3')
  return {
    ...actual,
    getRequestIP: vi.fn(() => '203.0.113.7'),
  }
})

const BROWSER_HEADERS = {
  'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'sec-fetch-mode': 'navigate',
}

function makeEvent(headers: Record<string, string>, path = '/authorize') {
  const responseHeaders: Record<string, unknown> = {}
  const res = {
    statusCode: 200,
    body: undefined as string | undefined,
    setHeader(name: string, value: unknown) {
      responseHeaders[name.toLowerCase()] = value
    },
    getHeader(name: string) {
      return responseHeaders[name.toLowerCase()]
    },
    removeHeader(name: string) {
      delete responseHeaders[name.toLowerCase()]
    },
    end(body?: string) {
      this.body = body
    },
  }
  const event = { path, node: { req: { headers, url: path }, res } } as any
  return { event, res, responseHeaders }
}

function registerPlugin(plugin: (app: any) => void) {
  const hooks: Record<string, (...args: any[]) => unknown> = {}
  plugin({ hooks: { hook: (name: string, fn: any) => { hooks[name] = fn } } })
  return hooks
}

function fireError(error: any, headers: Record<string, string>) {
  const hooks = registerPlugin(problemDetailsPlugin)
  const { event, res, responseHeaders } = makeEvent(headers)
  hooks.error!(error, { event })
  return { res, responseHeaders }
}

const problemError = {
  statusCode: 401,
  statusMessage: 'Authentication required',
  data: { type: 'about:blank', title: 'Authentication required', status: 401 },
}

describe('browser error page negotiation (problem-details plugin)', () => {
  it('serves HTML with status code and plain-language title to browser navigations', () => {
    const { res, responseHeaders } = fireError(problemError, BROWSER_HEADERS)

    expect(String(responseHeaders['content-type'])).toContain('text/html')
    expect(res.statusCode).toBe(401)
    expect(res.body).toContain('401')
    expect(res.body).toContain('Anmeldung erforderlich')
    // No raw problem+json leaking into the page
    expect(res.body).not.toContain('"type"')
    expect(res.body).not.toContain('about:blank')
  })

  it('keeps problem+json untouched for JSON clients', () => {
    const { res, responseHeaders } = fireError(problemError, { accept: 'application/json' })

    expect(responseHeaders['content-type']).toBe('application/problem+json')
    expect(res.statusCode).toBe(401)
    expect(JSON.parse(res.body!)).toEqual(problemError.data)
  })

  it('keeps problem+json when no Accept header is present', () => {
    const { res, responseHeaders } = fireError(problemError, {})

    expect(responseHeaders['content-type']).toBe('application/problem+json')
    expect(JSON.parse(res.body!)).toEqual(problemError.data)
  })

  it('treats XHR requests as API clients even when Accept includes text/html', () => {
    const { res } = fireError(problemError, {
      'accept': 'text/html',
      'x-requested-with': 'XMLHttpRequest',
    })

    expect(JSON.parse(res.body!)).toEqual(problemError.data)
  })

  it('treats cors fetches as API clients even when Accept includes text/html', () => {
    const { res } = fireError(problemError, {
      'accept': 'text/html',
      'sec-fetch-mode': 'cors',
    })

    expect(JSON.parse(res.body!)).toEqual(problemError.data)
  })

  it('treats clients preferring application/json as API clients', () => {
    const { res } = fireError(problemError, {
      accept: 'application/json, text/html;q=0.9',
    })

    expect(JSON.parse(res.body!)).toEqual(problemError.data)
  })

  it('renders 5xx pages without leaking internal details', () => {
    const internal = 'connect ECONNREFUSED 10.0.0.5:5432 at Database.connect'
    const { res, responseHeaders } = fireError(
      { statusCode: 500, statusMessage: 'Internal Server Error', message: internal },
      BROWSER_HEADERS,
    )

    expect(String(responseHeaders['content-type'])).toContain('text/html')
    expect(res.statusCode).toBe(500)
    expect(res.body).toContain('500')
    expect(res.body).not.toContain('ECONNREFUSED')
    expect(res.body).not.toContain('10.0.0.5')
  })

  it('still wraps generic errors as problem+json for API clients', () => {
    const { res, responseHeaders } = fireError(
      { statusCode: 500, statusMessage: 'Internal Server Error', message: 'boom' },
      { accept: 'application/json' },
    )

    expect(responseHeaders['content-type']).toBe('application/problem+json')
    expect(JSON.parse(res.body!)).toEqual({
      type: 'about:blank',
      title: 'Internal Server Error',
      status: 500,
      detail: 'boom',
    })
  })
})

describe('browser error page for the rate limiter (429)', () => {
  afterEach(() => {
    delete process.env.OPENAPE_RATE_LIMIT_MAX_AUTH
  })

  async function exhaustLimit(headers: Record<string, string>, ip: string) {
    const { getRequestIP } = await import('h3')
    ;(getRequestIP as any).mockReturnValue(ip)
    process.env.OPENAPE_RATE_LIMIT_MAX_AUTH = '2'
    const hooks = registerPlugin(rateLimitPlugin)
    let last!: ReturnType<typeof makeEvent>
    for (let i = 0; i < 3; i++) {
      last = makeEvent(headers)
      hooks.request!(last.event)
    }
    return last
  }

  it('serves an HTML page with the wait time to browsers', async () => {
    const { res, responseHeaders } = await exhaustLimit(BROWSER_HEADERS, '198.51.100.1')

    expect(res.statusCode).toBe(429)
    expect(String(responseHeaders['content-type'])).toContain('text/html')
    expect(responseHeaders['retry-after']).toBeDefined()
    expect(res.body).toContain('429')
    expect(res.body).toContain('Zu viele Anfragen')
    expect(res.body).toMatch(/\d+ Sekunden/)
    expect(res.body).toContain('Erneut versuchen')
  })

  it('keeps problem+json for API clients', async () => {
    const { res, responseHeaders } = await exhaustLimit({ accept: 'application/json' }, '198.51.100.2')

    expect(res.statusCode).toBe(429)
    expect(responseHeaders['content-type']).toBe('application/problem+json')
    const body = JSON.parse(res.body!)
    expect(body).toMatchObject({ type: 'about:blank', title: 'Too Many Requests', status: 429 })
    expect(body.detail).toMatch(/Try again in \d+ seconds/)
  })
})

describe('wantsHtmlErrorPage', () => {
  it('accepts browser navigations', () => {
    expect(wantsHtmlErrorPage(BROWSER_HEADERS)).toBe(true)
    expect(wantsHtmlErrorPage({ accept: 'text/html' })).toBe(true)
  })

  it('rejects API-shaped requests', () => {
    expect(wantsHtmlErrorPage({})).toBe(false)
    expect(wantsHtmlErrorPage({ accept: 'application/json' })).toBe(false)
    expect(wantsHtmlErrorPage({ 'accept': 'text/html', 'x-requested-with': 'xmlhttprequest' })).toBe(false)
    expect(wantsHtmlErrorPage({ 'accept': 'text/html', 'sec-fetch-mode': 'cors' })).toBe(false)
    expect(wantsHtmlErrorPage({ 'accept': 'text/html', 'sec-fetch-mode': 'no-cors' })).toBe(false)
    expect(wantsHtmlErrorPage({ accept: 'application/json, text/html;q=0.5' })).toBe(false)
  })
})

describe('renderErrorPage', () => {
  it('is a self-contained page without external assets', () => {
    const html = renderErrorPage(429, { retryAfterSeconds: 41 })
    expect(html).toContain('<!DOCTYPE html>')
    expect(html).toContain('prefers-color-scheme')
    expect(html).not.toMatch(/src="http/)
    expect(html).not.toMatch(/href="http/)
  })

  it('shows the wait time and countdown hook on 429', () => {
    const html = renderErrorPage(429, { retryAfterSeconds: 41 })
    expect(html).toContain('41 Sekunden')
    expect(html).toContain('data-countdown="41"')
  })

  it('ignores non-numeric retry values', () => {
    const html = renderErrorPage(429, { retryAfterSeconds: Number.NaN })
    expect(html).not.toContain('data-countdown')
  })
})
