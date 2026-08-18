import { describe, expect, it } from 'vitest'
import { problemMessage } from '../app/utils/problem-message'

describe('problemMessage', () => {
  it('prefers the problem title and keeps the detail', () => {
    const msg = problemMessage({ data: { title: 'insufficient role', detail: 'requires manager' } })
    expect(msg).toEqual({ title: 'insufficient role', detail: 'requires manager' })
  })

  it('falls back to the h3 status message', () => {
    expect(problemMessage({ statusMessage: 'Not Found' }).title).toBe('Not Found')
  })

  it('falls back to a plain error message', () => {
    expect(problemMessage(new Error('Failed to fetch')).title).toBe('Failed to fetch')
  })

  it('uses the given fallback when the error says nothing', () => {
    expect(problemMessage({}, 'Deal konnte nicht angelegt werden').title).toBe('Deal konnte nicht angelegt werden')
  })

  it('survives null', () => {
    expect(problemMessage(null).title).toBe('Das hat nicht geklappt')
  })
})
