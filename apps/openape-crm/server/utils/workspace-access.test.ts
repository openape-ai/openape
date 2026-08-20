import { describe, expect, it } from 'vitest'
import { atLeast } from './workspace-access'

describe('atLeast', () => {
  it('lets a role satisfy its own level', () => {
    expect(atLeast('member', 'member')).toBe(true)
    expect(atLeast('manager', 'manager')).toBe(true)
    expect(atLeast('owner', 'owner')).toBe(true)
  })

  it('lets higher roles satisfy lower requirements', () => {
    expect(atLeast('owner', 'manager')).toBe(true)
    expect(atLeast('manager', 'member')).toBe(true)
  })

  it('refuses lower roles', () => {
    expect(atLeast('member', 'manager')).toBe(false)
    expect(atLeast('manager', 'owner')).toBe(false)
  })

  it('refuses non-members', () => {
    expect(atLeast(undefined, 'member')).toBe(false)
  })
})
