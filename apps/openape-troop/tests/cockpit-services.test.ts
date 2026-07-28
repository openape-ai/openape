import { beforeAll, describe, expect, it } from 'vitest'
import { normalizeServiceUrl } from '../server/utils/cockpit/services'

beforeAll(() => {
  ;(globalThis as unknown as { createError: (o: unknown) => Error }).createError = (o) => {
    const e = new Error((o as { statusMessage?: string }).statusMessage ?? 'error')
    return e
  }
})

describe('normalizeServiceUrl', () => {
  it('accepts https and strips path/trailing slash to origin', () => {
    expect(normalizeServiceUrl('https://zaz.delta-mind.at/api/x/')).toEqual({
      baseUrl: 'https://zaz.delta-mind.at',
      host: 'zaz.delta-mind.at',
    })
  })
  it('rejects http (plaintext) targets', () => {
    expect(() => normalizeServiceUrl('http://zaz.delta-mind.at')).toThrow('https')
  })
  it('rejects garbage', () => {
    expect(() => normalizeServiceUrl('not a url')).toThrow('invalid')
  })
})
