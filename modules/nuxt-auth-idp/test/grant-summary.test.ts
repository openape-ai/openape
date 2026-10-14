import { describe, expect, it } from 'vitest'
import { grantSummaryView, safeSummaryLink } from '../src/runtime/utils/grant-summary'

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

describe('grantSummaryView', () => {
  it('keeps the description line breaks and links only http(s)', () => {
    expect(grantSummaryView({ title: 'Merge PR #1307', description: 'CI: 4/4 grün\nNo conflicts', origin: 'Merge Pod', link: 'javascript:alert(1)' }))
      .toEqual({ title: 'Merge PR #1307', description: 'CI: 4/4 grün\nNo conflicts', origin: 'Merge Pod', link: null })
  })

  it('treats a missing or blank title as no summary and blank optional fields as absent', () => {
    expect(grantSummaryView({ title: '   ' })).toBeNull()
    expect(grantSummaryView(undefined)).toBeNull()
    expect(grantSummaryView({ title: 'x', description: ' \n ', origin: '' })).toEqual({ title: 'x', description: null, origin: null, link: null })
  })
})
