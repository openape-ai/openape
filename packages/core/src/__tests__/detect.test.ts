import { describe, expect, it } from 'vitest'
import { detectRuntime } from '../dns/detect.js'

describe('detectRuntime', () => {
  it('returns node in Node.js environment', () => {
    // vitest runs in Node.js, so this should return 'node'
    expect(detectRuntime()).toBe('node')
  })

  // NOTE: The Deno, Bun, browser, and edge runtime paths cannot be reliably
  // tested in a vitest/Node.js environment without fragile global mocking that
  // breaks module isolation. These paths are runtime-specific:
  //   - 'deno': requires typeof Deno !== 'undefined' && Deno.resolveDns
  //   - 'bun': requires typeof Bun !== 'undefined'
  //   - 'browser': requires 'document' in globalThis (without process.versions.node)
  //   - 'edge': falls through when process exists but dns module not available
  // Testing these would require complex global patching (deleting process,
  // stubbing Deno/Bun) which risks polluting the test environment.
})
