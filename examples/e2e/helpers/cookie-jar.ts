/**
 * Simple per-origin cookie tracking for E2E tests.
 * Uses response.headers.getSetCookie() (Node 20+).
 */
export class CookieJar {
  private store = new Map<string, Map<string, string>>()

  /** Extract and store cookies from a response for the given URL's origin. */
  capture(url: string, response: Response): void {
    const origin = new URL(url).origin
    const cookies = response.headers.getSetCookie()
    if (!cookies.length)
      return

    let originJar = this.store.get(origin)
    if (!originJar) {
      originJar = new Map()
      this.store.set(origin, originJar)
    }

    for (const cookie of cookies) {
      const [nameValue] = cookie.split(';')
      const eqIndex = nameValue.indexOf('=')
      if (eqIndex === -1)
        continue
      const name = nameValue.slice(0, eqIndex).trim()
      const value = nameValue.slice(eqIndex + 1).trim()
      originJar.set(name, value)
    }
  }

  /** Return a Cookie header string for the given URL's origin. */
  headerFor(url: string): string | undefined {
    const origin = new URL(url).origin
    const originJar = this.store.get(origin)
    if (!originJar || originJar.size === 0)
      return undefined

    return Array.from(originJar.entries())
      .map(([name, value]) => `${name}=${value}`)
      .join('; ')
  }
}
