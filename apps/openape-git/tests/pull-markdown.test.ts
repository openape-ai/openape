import { describe, expect, it } from 'vitest'
import { renderMarkdown } from '../server/utils/render'

// PR bodies and comments are written by anyone with write access, so they are
// untrusted input in the same way repo READMEs are — same renderer, same
// allowlist, no second implementation.
describe('rendering pull request prose', () => {
  it('renders the structures a PR body actually uses', () => {
    const html = renderMarkdown('## Why\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n```js\nconst x = 1\n```\n')
    expect(html).toContain('<h2>Why</h2>')
    expect(html).toContain('<table>')
    expect(html).toContain('<code')
  })

  it('drops a script tag', () => {
    expect(renderMarkdown('hi <script>alert(1)</script>')).not.toContain('script')
  })

  it('drops an event handler on an image', () => {
    const html = renderMarkdown('<img src=x onerror="alert(1)">')
    expect(html).not.toContain('onerror')
  })

  it('drops a javascript: link but keeps the text', () => {
    const html = renderMarkdown('[click](javascript:alert(1))')
    expect(html).not.toContain('javascript:')
    expect(html).toContain('click')
  })

  it('marks outgoing links so they cannot reach back', () => {
    expect(renderMarkdown('[x](https://example.test)')).toContain('rel="noopener noreferrer"')
  })
})
