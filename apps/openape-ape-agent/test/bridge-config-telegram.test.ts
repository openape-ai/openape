import { describe, expect, it } from 'vitest'
import { readConfig } from '../src/bridge-config'

const base = { APE_CHAT_BRIDGE_MODEL: 'gpt-5.5' } satisfies NodeJS.ProcessEnv

describe('readConfig — Telegram adapter activation', () => {
  it('leaves telegram undefined when no bot token is present', () => {
    expect(readConfig({ ...base }).telegram).toBeUndefined()
  })

  it('hard-locks the owner when an explicit numeric id is given', () => {
    const cfg = readConfig({ ...base, TELEGRAM_BOT_TOKEN: 'secret:123', TELEGRAM_OWNER_USER_ID: '111' })
    expect(cfg.telegram).toEqual({ botToken: 'secret:123', ownerUserId: 111 })
  })

  it('activates with token alone — owner is learned on first contact (TOFU)', () => {
    const cfg = readConfig({ ...base, TELEGRAM_BOT_TOKEN: 'secret:123' })
    expect(cfg.telegram).toEqual({ botToken: 'secret:123' })
    expect(cfg.telegram?.ownerUserId).toBeUndefined()
  })

  it('surfaces a present-but-non-numeric owner id rather than silently falling back to TOFU', () => {
    expect(() => readConfig({ ...base, TELEGRAM_BOT_TOKEN: 'secret:123', TELEGRAM_OWNER_USER_ID: 'nope' })).toThrow(/TELEGRAM_OWNER_USER_ID/)
  })
})
