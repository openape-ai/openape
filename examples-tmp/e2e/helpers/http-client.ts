import { CookieJar } from './cookie-jar.js'

/**
 * HTTP client with cookie jar and manual redirect following.
 * Wraps fetch with redirect: 'manual' so we can capture cookies at each hop.
 */
export class HttpClient {
  jar = new CookieJar()

  /** Perform a fetch with cookie tracking and manual redirects. */
  async fetch(url: string, init?: RequestInit): Promise<Response> {
    const headers = new Headers(init?.headers)
    const cookie = this.jar.headerFor(url)
    if (cookie)
      headers.set('Cookie', cookie)

    const res = await fetch(url, {
      ...init,
      headers,
      redirect: 'manual',
    })

    this.jar.capture(url, res)
    return res
  }

  /** Follow a redirect chain, capturing cookies at each hop. Returns the final response. */
  async followRedirects(url: string, maxHops = 10): Promise<{ response: Response, finalUrl: string }> {
    let currentUrl = url
    for (let i = 0; i < maxHops; i++) {
      const res = await this.fetch(currentUrl)
      if (res.status >= 300 && res.status < 400) {
        const location = res.headers.get('Location')
        if (!location)
          throw new Error(`Redirect without Location header at ${currentUrl}`)
        currentUrl = new URL(location, currentUrl).href
        continue
      }
      return { response: res, finalUrl: currentUrl }
    }
    throw new Error(`Too many redirects (>${maxHops})`)
  }

  /** POST JSON body to a URL, returns parsed JSON response. */
  async postJSON<T = unknown>(url: string, body: unknown): Promise<{ status: number, data: T }> {
    const res = await this.fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const data = await res.json() as T
    return { status: res.status, data }
  }

  /** GET a URL, returns parsed JSON response. */
  async getJSON<T = unknown>(url: string): Promise<{ status: number, data: T }> {
    const res = await this.fetch(url)
    const data = await res.json() as T
    return { status: res.status, data }
  }
}
