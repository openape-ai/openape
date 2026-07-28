import { describe, expect, it } from 'vitest'
import { shouldSubmitComposerKey } from '../app/components/cockpit/composer-input'

function key(overrides: Partial<KeyboardEvent> = {}): KeyboardEvent {
  return { key: 'Enter', shiftKey: false, ...overrides } as KeyboardEvent
}

describe('cockpit composer keyboard behaviour', () => {
  it('keeps Enter as a newline on desktop', () => {
    expect(shouldSubmitComposerKey(key(), false)).toBe(false)
  })

  it('submits with Shift+Enter on desktop', () => {
    expect(shouldSubmitComposerKey(key({ shiftKey: true }), false)).toBe(true)
  })

  it('never submits from the keyboard on mobile', () => {
    expect(shouldSubmitComposerKey(key(), true)).toBe(false)
    expect(shouldSubmitComposerKey(key({ shiftKey: true }), true)).toBe(false)
  })

  it('ignores other keys', () => {
    expect(shouldSubmitComposerKey(key({ key: 'Escape', shiftKey: true }), false)).toBe(false)
  })
})
