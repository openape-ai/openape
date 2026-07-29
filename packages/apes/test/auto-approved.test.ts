import { describe, expect, it } from 'vitest'
import { isAutoApproved } from '../src/shapes/grants'

// #1083: a grant the IdP approved at creation time must not page the owner.
// The "grant is waiting for you" channel is only worth something if it never
// fires for something already decided.
describe('isAutoApproved', () => {
  it('is true when the IdP says it approved the grant itself', () => {
    expect(isAutoApproved({ approved_automatically: true })).toBe(true)
  })
  it('is true when the record already reads approved', () => {
    expect(isAutoApproved({ status: 'approved' })).toBe(true)
  })
  it('is true for the real YOLO shape', () => {
    expect(isAutoApproved({ status: 'approved', approved_automatically: true, auto_approval_kind: 'yolo' })).toBe(true)
  })
  it('is false for a grant that really waits for a human', () => {
    expect(isAutoApproved({ status: 'pending' })).toBe(false)
    expect(isAutoApproved({ status: 'pending', approved_automatically: false })).toBe(false)
  })
  it('is false when the response says nothing — pending is the safe reading', () => {
    expect(isAutoApproved({})).toBe(false)
  })
  it('does not treat other terminal states as auto-approved', () => {
    expect(isAutoApproved({ status: 'denied' })).toBe(false)
    expect(isAutoApproved({ status: 'revoked' })).toBe(false)
  })
})
