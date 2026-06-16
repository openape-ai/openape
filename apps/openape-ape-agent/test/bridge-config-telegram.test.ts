import { describe, expect, it } from 'vitest'
import { readConfig } from '../src/bridge-config'

const base = { APE_CHAT_BRIDGE_MODEL: 'gpt-5.5' } satisfies NodeJS.ProcessEnv

describe('readConfig — Telegram adapter activation', () => {
  it('leaves telegram undefined when no bot token is present', () => {
    expect(readConfig({ ...base }).telegram).toBeUndefined()
  })

  it('activates the adapter when both bot token and owner id are set', () => {
    const cfg = readConfig({ ...base, TELEGRAM_BOT_TOKEN: 'secret:123', TELEGRAM_OWNER_USER_ID: '111' })
    expect(cfg.telegram).toEqual({ botToken: 'secret:123', ownerUserId: 111 })
  })

  it('hard-fails when a bot token is set without a numeric owner lock', () => {
    expect(() => readConfig({ ...base, TELEGRAM_BOT_TOKEN: 'secret:123' })).toThrow(/TELEGRAM_OWNER_USER_ID/)
    expect(() => readConfig({ ...base, TELEGRAM_BOT_TOKEN: 'secret:123', TELEGRAM_OWNER_USER_ID: 'nope' })).toThrow(/TELEGRAM_OWNER_USER_ID/)
  })
})
