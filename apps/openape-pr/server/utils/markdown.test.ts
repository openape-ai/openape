import { describe, expect, it } from 'vitest'
import { renderMarkdown } from './markdown'

describe('renderMarkdown', () => {
  it('renders a code span with <tags> once-escaped (no double-escaping)', () => {
    const html = renderMarkdown('The reply `<textarea>` was locked.')
    expect(html).toContain('<code>&lt;textarea&gt;</code>')
    expect(html).not.toContain('&amp;lt;') // the double-escape bug
  })

  it('escapes raw HTML in prose instead of injecting it', () => {
    const html = renderMarkdown('hello <script>alert(1)</script> world')
    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;')
  })

  it('keeps http links, neutralises javascript: links', () => {
    expect(renderMarkdown('[ok](https://x.test)')).toContain('href="https://x.test"')
    expect(renderMarkdown('[no](javascript:alert(1))')).toContain('href="#"')
  })
})
