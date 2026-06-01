import { afterEach, describe, expect, it } from 'vitest'
import { resolveTroopUrl, TroopApi } from '../src/troop-api'

const ORIGINAL = process.env.OPENAPE_TROOP_URL

afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.OPENAPE_TROOP_URL
  else process.env.OPENAPE_TROOP_URL = ORIGINAL
})

describe('resolveTroopUrl', () => {
  it('defaults to the prod troop URL', () => {
    delete process.env.OPENAPE_TROOP_URL
    expect(resolveTroopUrl()).toBe('https://troop.openape.ai')
  })

  it('honors an explicit override and strips trailing slash', () => {
    expect(resolveTroopUrl('https://staging.troop.example/')).toBe('https://staging.troop.example')
  })

  it('falls back to OPENAPE_TROOP_URL env', () => {
    process.env.OPENAPE_TROOP_URL = 'http://127.0.0.1:9091/'
    expect(resolveTroopUrl()).toBe('http://127.0.0.1:9091')
  })

  it('explicit override wins over env', () => {
    process.env.OPENAPE_TROOP_URL = 'http://env-host:1234'
    expect(resolveTroopUrl('https://explicit.example')).toBe('https://explicit.example')
  })
})

describe('TroopApi', () => {
  it('derives aud from the host', () => {
    const api = new TroopApi('https://troop.openape.ai')
    expect(api.aud).toBe('troop.openape.ai')
    expect(api.url).toBe('https://troop.openape.ai')
  })
})
