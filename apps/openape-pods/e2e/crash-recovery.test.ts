import { describe, it } from 'vitest'
import { cleanupAfterEach, retainsCompleteUnit } from './fixtures/crash'

// Termination cases are split across two files so they run on separate workers.
cleanupAfterEach()
describe('checkpoint recovery in Electron', () => {
  it.each(['worker', 'app'] as const)('retains a complete unit through %s termination and retries without duplication', target => retainsCompleteUnit(target))
})
