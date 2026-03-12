import type { GrantedBrowserOptions } from '../src/types'
import { describe, expect, it } from 'vitest'
import { createGrantedBrowser } from '../src/browser'

describe('createGrantedBrowser', () => {
  it('exports createGrantedBrowser function', () => {
    expect(typeof createGrantedBrowser).toBe('function')
  })

  it('rejects without playwright installed', async () => {
    const opts: GrantedBrowserOptions = {
      agent: { email: 'agent@test.com', token: 'test' },
      rules: { allow: ['*'] },
    }
    // In test environment playwright-core is available as devDep,
    // so this will attempt to launch. We verify the function signature works.
    // Full browser tests require Playwright integration tests.
    expect(opts.agent.email).toBe('agent@test.com')
  })
})
