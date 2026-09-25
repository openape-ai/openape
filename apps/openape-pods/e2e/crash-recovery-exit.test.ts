import { describe, it } from 'vitest'
import { cleanupAfterEach, retainsCompleteUnit } from './fixtures/crash'

cleanupAfterEach()
describe('checkpoint recovery in Electron', () => {
  it.each(['quit', 'script'] as const)('retains a complete unit through %s termination and retries without duplication', target => retainsCompleteUnit(target))
})
