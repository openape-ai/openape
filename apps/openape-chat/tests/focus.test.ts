import { afterEach, describe, expect, it } from 'vitest'
import { _internal, clearFocusForPeer, isUserFocusedOn, setFocus } from '../server/utils/focus'

afterEach(() => {
  _internal.focusByPeer.clear()
})

describe('focus registry — push suppression', () => {
  it('returns false when nobody is focused', () => {
    expect(isUserFocusedOn('alice@example.com', 'room-1', 'thread-a')).toBe(false)
  })

  it('matches the right user + room + thread', () => {
    setFocus('peer-1', { email: 'alice@example.com', roomId: 'room-1', threadId: 'thread-a' })
    expect(isUserFocusedOn('alice@example.com', 'room-1', 'thread-a')).toBe(true)
    expect(isUserFocusedOn('alice@example.com', 'room-1', 'thread-b')).toBe(false)
    expect(isUserFocusedOn('alice@example.com', 'room-2', 'thread-a')).toBe(false)
    expect(isUserFocusedOn('bob@example.com', 'room-1', 'thread-a')).toBe(false)
  })

  it('treats room-level focus (no threadId) as a match for any thread in the room — safer than over-notifying', () => {
    setFocus('peer-1', { email: 'alice@example.com', roomId: 'room-1' })
    expect(isUserFocusedOn('alice@example.com', 'room-1', 'thread-a')).toBe(true)
    expect(isUserFocusedOn('alice@example.com', 'room-1', 'thread-b')).toBe(true)
    expect(isUserFocusedOn('alice@example.com', 'room-2', 'thread-a')).toBe(false)
  })

  it('treats incoming message with no threadId as a match for any focused thread in the room', () => {
    setFocus('peer-1', { email: 'alice@example.com', roomId: 'room-1', threadId: 'thread-a' })
    expect(isUserFocusedOn('alice@example.com', 'room-1', undefined)).toBe(true)
  })

  it('multi-device: any peer focused on the room+thread suppresses push', () => {
    setFocus('peer-desktop', { email: 'alice@example.com', roomId: 'room-1', threadId: 'thread-a' })
    setFocus('peer-phone', { email: 'alice@example.com', roomId: 'room-2', threadId: 'thread-z' })
    expect(isUserFocusedOn('alice@example.com', 'room-1', 'thread-a')).toBe(true)
    expect(isUserFocusedOn('alice@example.com', 'room-2', 'thread-z')).toBe(true)
    // The other peer's focus is irrelevant for this lookup.
    expect(isUserFocusedOn('alice@example.com', 'room-3', 'thread-x')).toBe(false)
  })

  it('clearFocusForPeer drops only that peer\'s row', () => {
    setFocus('peer-desktop', { email: 'alice@example.com', roomId: 'room-1', threadId: 'thread-a' })
    setFocus('peer-phone', { email: 'alice@example.com', roomId: 'room-1', threadId: 'thread-a' })
    clearFocusForPeer('peer-desktop')
    // Phone is still focused → still suppress.
    expect(isUserFocusedOn('alice@example.com', 'room-1', 'thread-a')).toBe(true)
    clearFocusForPeer('peer-phone')
    expect(isUserFocusedOn('alice@example.com', 'room-1', 'thread-a')).toBe(false)
  })
})
