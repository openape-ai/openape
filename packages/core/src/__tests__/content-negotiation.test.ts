import { describe, expect, it } from 'vitest'
import { wantsHtmlErrorPage } from '../net/content-negotiation.js'

const BROWSER = {
  'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'sec-fetch-mode': 'navigate',
}

describe('wantsHtmlErrorPage', () => {
  it('says yes to a browser navigation', () => {
    expect(wantsHtmlErrorPage(BROWSER)).toBe(true)
  })

  it('says no to an API client', () => {
    expect(wantsHtmlErrorPage({ accept: 'application/json' })).toBe(false)
    expect(wantsHtmlErrorPage({})).toBe(false)
  })

  it('says no to fetch() from a page, even with a browser Accept header', () => {
    // Same Accept header, but Sec-Fetch-Mode marks it as programmatic — the
    // caller wants the problem+json body, not a page to look at.
    expect(wantsHtmlErrorPage({ ...BROWSER, 'sec-fetch-mode': 'cors' })).toBe(false)
  })

  it('says no to an XHR', () => {
    expect(wantsHtmlErrorPage({ ...BROWSER, 'x-requested-with': 'XMLHttpRequest' })).toBe(false)
  })

  it('does not let a browser wildcard outrank html', () => {
    // `*/*;q=0.8` must not count as "prefers JSON" — only an explicit
    // application/json listing does.
    expect(wantsHtmlErrorPage({ accept: 'text/html;q=0.9,*/*;q=1.0' })).toBe(true)
  })

  it('respects a client that explicitly prefers json over html', () => {
    expect(wantsHtmlErrorPage({ accept: 'text/html;q=0.5,application/json;q=0.9' })).toBe(false)
  })

  it('reads a repeated header from its array form', () => {
    expect(wantsHtmlErrorPage({ accept: ['text/html'], 'sec-fetch-mode': ['navigate'] })).toBe(true)
  })

  it('treats an empty repeated header as absent', () => {
    // `raw[0] ?? ''` — an array-shaped header that is empty must not throw.
    expect(wantsHtmlErrorPage({ accept: [] })).toBe(false)
  })

  it('ignores a malformed q-value instead of trusting it', () => {
    // `Number('abc')` is NaN; without the isFinite guard the media type would
    // silently rank as NaN and every comparison against it would be false.
    expect(wantsHtmlErrorPage({ accept: 'text/html;q=abc' })).toBe(true)
  })

  it('ignores an accept parameter that is not q', () => {
    expect(wantsHtmlErrorPage({ accept: 'text/html;level=1' })).toBe(true)
  })
})
