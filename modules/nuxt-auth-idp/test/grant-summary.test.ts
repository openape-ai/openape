import { describe, expect, it } from 'vitest'
import { grantSummaryText, safeSummaryLink } from '../src/runtime/utils/grant-summary'

describe('safeSummaryLink', () => {
  it('passes plain http and https through', () => {
    expect(safeSummaryLink('https://git.openape.ai/openape-ai/openape/pulls/1307'))
      .toBe('https://git.openape.ai/openape-ai/openape/pulls/1307')
    expect(safeSummaryLink('http://127.0.0.1:3000/x')).toBe('http://127.0.0.1:3000/x')
  })

  it('refuses every scheme that can execute or embed', () => {
    expect(safeSummaryLink('javascript:alert(1)')).toBeNull()
    expect(safeSummaryLink('JavaScript:alert(1)')).toBeNull()
    expect(safeSummaryLink('data:text/html,<script>alert(1)</script>')).toBeNull()
    expect(safeSummaryLink('vbscript:msgbox')).toBeNull()
    expect(safeSummaryLink('file:///etc/passwd')).toBeNull()
  })

  it('refuses anything that is not a URL at all', () => {
    expect(safeSummaryLink('git.openape.ai/pulls/1307')).toBeNull()
    expect(safeSummaryLink('')).toBeNull()
    expect(safeSummaryLink(undefined)).toBeNull()
  })
})

describe('grantSummaryText', () => {
  it('keeps the requester line breaks', () => {
    expect(grantSummaryText({ text: 'Merge PR #1307\nCI: 4/4 grün' }))
      .toBe('Merge PR #1307\nCI: 4/4 grün')
  })

  it('treats an empty or blank summary as none', () => {
    expect(grantSummaryText({ text: '   \n ' })).toBeNull()
    expect(grantSummaryText(undefined)).toBeNull()
  })
})
