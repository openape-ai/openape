import { describe, expect, it } from 'vitest'
import {
  buildSafeCommandRequest,
  isDefaultSafeCommandGrant,
  isSafeCommandGrant,
  SAFE_COMMAND_DEFAULTS,
  SAFE_COMMAND_REASON_CUSTOM,
  SAFE_COMMAND_REASON_DEFAULT,
} from '../src/safe-commands.js'

describe('SAFE_COMMAND_DEFAULTS', () => {
  it('contains exactly 14 entries', () => {
    expect(SAFE_COMMAND_DEFAULTS).toHaveLength(14)
  })

  it('has unique cli_ids', () => {
    const ids = SAFE_COMMAND_DEFAULTS.map(d => d.cli_id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('every entry has display + description metadata', () => {
    for (const d of SAFE_COMMAND_DEFAULTS) {
      expect(d.display.length).toBeGreaterThan(0)
      expect(d.description.length).toBeGreaterThan(0)
    }
  })
})

describe('buildSafeCommandRequest', () => {
  it('produces a StandingGrantRequest with default reason', () => {
    const r = buildSafeCommandRequest({ cliId: 'ls', action: 'read', owner: 'a@x', delegate: 'b@x' })
    expect(r.type).toBe('standing')
    expect(r.owner).toBe('a@x')
    expect(r.delegate).toBe('b@x')
    expect(r.audience).toBe('shapes')
    expect(r.target_host).toBe('*')
    expect(r.cli_id).toBe('ls')
    expect(r.resource_chain_template).toEqual([])
    expect(r.action).toBe('read')
    expect(r.max_risk).toBe('low')
    expect(r.grant_type).toBe('always')
    expect(r.reason).toBe(SAFE_COMMAND_REASON_DEFAULT)
  })

  it('custom flag switches the reason marker', () => {
    const r = buildSafeCommandRequest({
      cliId: 'jq',
      action: 'exec',
      owner: 'a@x',
      delegate: 'b@x',
      custom: true,
    })
    expect(r.reason).toBe(SAFE_COMMAND_REASON_CUSTOM)
  })

  it('respects requested action', () => {
    const r = buildSafeCommandRequest({ cliId: 'echo', action: 'exec', owner: 'a@x', delegate: 'b@x' })
    expect(r.action).toBe('exec')
  })
})

describe('isSafeCommandGrant / isDefaultSafeCommandGrant', () => {
  it('detects both default and custom via reason marker', () => {
    expect(isSafeCommandGrant({ request: { reason: SAFE_COMMAND_REASON_DEFAULT } })).toBe(true)
    expect(isSafeCommandGrant({ request: { reason: SAFE_COMMAND_REASON_CUSTOM } })).toBe(true)
  })

  it('rejects other reasons and missing reasons', () => {
    expect(isSafeCommandGrant({ request: { reason: 'something-else' } })).toBe(false)
    expect(isSafeCommandGrant({ request: {} })).toBe(false)
    expect(isSafeCommandGrant({})).toBe(false)
  })

  it('isDefaultSafeCommandGrant rejects custom entries', () => {
    expect(isDefaultSafeCommandGrant({ request: { reason: SAFE_COMMAND_REASON_DEFAULT } })).toBe(true)
    expect(isDefaultSafeCommandGrant({ request: { reason: SAFE_COMMAND_REASON_CUSTOM } })).toBe(false)
  })
})
