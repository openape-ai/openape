import { describe, expect, it } from 'vitest'
import { ownsTask } from '../server/utils/cockpit/resolve-guard'

describe('deferred task persistence owner guard', () => {
  it('does not persist a deferred task resolved by a different owner', () => {
    expect(ownsTask({ owner: 'alice@x' }, 'bob@x')).toBe(false)
  })

  it('persists a deferred task resolved by its owner', () => {
    expect(ownsTask({ owner: 'alice@x' }, 'alice@x')).toBe(true)
  })
})
