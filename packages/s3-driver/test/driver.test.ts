import { describe, expect, it } from 'vitest'
import createDriver from '../src/index'

describe('s3 driver', () => {
  it('creates a named driver instance', () => {
    const driver = createDriver({
      accessKeyId: 'key',
      secretAccessKey: 'secret',
      endpoint: 'https://s3.example.com',
      region: 'us-east-1',
      bucket: 'bucket',
    })

    expect(driver.name).toBe('s3-compat')
    expect(typeof driver.getItem).toBe('function')
  })
})
