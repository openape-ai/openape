import { describe, expect, it } from 'vitest'
import {
  isSafeCommandGrant,
  SAFE_COMMAND_DEFAULTS,
  SAFE_COMMAND_REASON_CUSTOM,
  SAFE_COMMAND_REASON_DEFAULT,
} from '../app/utils/safe-commands'

describe('isSafeCommandGrant', () => {
  it('recognises both safe-command reasons', () => {
    expect(isSafeCommandGrant({ request: { reason: SAFE_COMMAND_REASON_DEFAULT } })).toBe(true)
    expect(isSafeCommandGrant({ request: { reason: SAFE_COMMAND_REASON_CUSTOM } })).toBe(true)
  })

  it('says no for any other grant, including a missing request', () => {
    expect(isSafeCommandGrant({ request: { reason: 'user-approved' } })).toBe(false)
    expect(isSafeCommandGrant({})).toBe(false)
    expect(isSafeCommandGrant({ request: null })).toBe(false)
  })

  it('does not accept a reason that merely starts the same', () => {
    expect(isSafeCommandGrant({ request: { reason: `${SAFE_COMMAND_REASON_DEFAULT}-extra` } })).toBe(false)
  })
})

describe('safe command defaults', () => {
  it('lists every command once', () => {
    const ids = SAFE_COMMAND_DEFAULTS.map(c => c.cli_id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('marks only genuinely side-effect-free commands as exec', () => {
    // This mirrors packages/grants/src/safe-commands.ts — a command sliding
    // from read to exec here is a permission change, not a display detail.
    const exec = SAFE_COMMAND_DEFAULTS.filter(c => c.action === 'exec').map(c => c.cli_id)
    expect(exec).toEqual(['echo'])
  })

  it('describes every command for the approval screen', () => {
    for (const command of SAFE_COMMAND_DEFAULTS) {
      expect(command.display.length).toBeGreaterThan(0)
      expect(command.description.length).toBeGreaterThan(0)
    }
  })
})
