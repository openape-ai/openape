import { describe, expect, it } from 'vitest'
import { renderMarkdown } from '../app/utils/markdown'

// The rendered output feeds a v-html sink, so these assert that hostile plan
// bodies come out inert — no executable payload, no dangerous scheme.
describe('renderMarkdown sanitization', () => {
  it('strips <script> tags and their content', () => {
    const out = renderMarkdown('hi\n\n<script>alert(document.cookie)</script>')
    expect(out).not.toContain('<script')
    expect(out).not.toContain('alert(document.cookie)')
  })

  it('drops on* event handlers (img onerror)', () => {
    const out = renderMarkdown('<img src=x onerror="alert(1)">')
    expect(out).not.toContain('onerror')
    expect(out).not.toContain('alert(1)')
  })

  it('removes javascript: links but keeps the text', () => {
    const out = renderMarkdown('[click](javascript:alert(1))')
    expect(out).not.toContain('javascript:')
    expect(out).toContain('click')
  })

  it('strips data: image sources', () => {
    const out = renderMarkdown('<img src="data:text/html,<script>alert(1)</script>">')
    expect(out).not.toContain('data:')
    expect(out).not.toContain('<script')
  })

  it('drops <iframe>, <object> and <style>', () => {
    const out = renderMarkdown('<iframe src="//evil"></iframe><object data="x"></object><style>*{}</style>')
    expect(out).not.toContain('<iframe')
    expect(out).not.toContain('<object')
    expect(out).not.toContain('<style')
  })

  it('adds rel=noopener noreferrer to target=_blank links', () => {
    const out = renderMarkdown('<a href="https://ok.example" target="_blank">x</a>')
    expect(out).toContain('rel="noopener noreferrer"')
  })

  it('keeps benign formatting: headings, bold, links, code', () => {
    const out = renderMarkdown('# Title\n\n**bold** and [ok](https://ok.example)\n\n`code`')
    expect(out).toContain('<h1')
    expect(out).toContain('<strong>bold</strong>')
    expect(out).toContain('href="https://ok.example"')
    expect(out).toContain('<code>code</code>')
  })
})
