import { describe, expect, it } from 'vitest'
import { composeSystemPrompt } from '../server/utils/system-prompt'

describe('composeSystemPrompt', () => {
  it('appends the addendum after a blank-line separator', () => {
    expect(composeSystemPrompt('You are a Bluesky summariser.', 'Focus on the negative posts.'))
      .toBe('You are a Bluesky summariser.\n\nFocus on the negative posts.')
  })

  it('returns just the base when there is no addendum', () => {
    expect(composeSystemPrompt('base', '')).toBe('base')
    expect(composeSystemPrompt('base', null)).toBe('base')
    expect(composeSystemPrompt('base', undefined)).toBe('base')
    expect(composeSystemPrompt('base', '   ')).toBe('base')
  })

  it('returns just the addendum when the base is empty', () => {
    expect(composeSystemPrompt('', 'only addendum')).toBe('only addendum')
  })

  it('trims both sides', () => {
    expect(composeSystemPrompt('  base  ', '  add  ')).toBe('base\n\nadd')
  })

  it('is empty when both are empty', () => {
    expect(composeSystemPrompt('', '')).toBe('')
  })
})
