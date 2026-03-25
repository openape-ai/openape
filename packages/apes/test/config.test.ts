import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// We test the pure functions by reimporting with mocked paths
// Since the module uses hardcoded paths, we test the TOML parser and logic separately

describe('parseDuration', () => {
  it('parses seconds', async () => {
    const { parseDuration } = await import('../src/duration')
    expect(parseDuration('30s')).toBe(30)
  })

  it('parses minutes', async () => {
    const { parseDuration } = await import('../src/duration')
    expect(parseDuration('5m')).toBe(300)
  })

  it('parses hours', async () => {
    const { parseDuration } = await import('../src/duration')
    expect(parseDuration('1h')).toBe(3600)
  })

  it('parses days', async () => {
    const { parseDuration } = await import('../src/duration')
    expect(parseDuration('7d')).toBe(604800)
  })

  it('rejects invalid format', async () => {
    const { parseDuration } = await import('../src/duration')
    expect(() => parseDuration('abc')).toThrow('Invalid duration format')
  })
})

describe('config', () => {
  const testDir = join(tmpdir(), `apes-test-${Date.now()}`)
  const apesDir = join(testDir, '.config', 'apes')

  beforeEach(() => {
    mkdirSync(apesDir, { recursive: true })
  })

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true })
  })

  it('getIdpUrl respects APES_IDP env var', async () => {
    const original = process.env.APES_IDP
    process.env.APES_IDP = 'https://test.openape.at'
    try {
      const { getIdpUrl } = await import('../src/config')
      expect(getIdpUrl()).toBe('https://test.openape.at')
    }
    finally {
      if (original === undefined)
        delete process.env.APES_IDP
      else
        process.env.APES_IDP = original
    }
  })

  it('getIdpUrl prefers explicit over env', async () => {
    const { getIdpUrl } = await import('../src/config')
    expect(getIdpUrl('https://explicit.openape.at')).toBe('https://explicit.openape.at')
  })
})
