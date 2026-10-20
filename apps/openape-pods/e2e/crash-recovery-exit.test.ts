import { describe, it } from 'vitest'
import { cleanupAfterEach, retainsCompleteUnit } from './fixtures/crash'

cleanupAfterEach()
describe('checkpoint recovery in Electron', () => {
  it('retains a complete unit through quit termination and retries without duplication', () => retainsCompleteUnit('quit'), 120000)
  it('isolates script termination without a receipt and resumes its checkpoint on an explicit run', () => retainsCompleteUnit('script'), 120000)
})
