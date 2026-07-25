import { describe, expect, it } from 'vitest'
import { buildChangelogPayload } from '../server/utils/changelog'

describe('GET /api/changelog payload', () => {
  it('returns the Troop version and the complete changelog text', () => {
    const payload = buildChangelogPayload('# @openape/troop\n\n## 0.1.10\n')

    expect(payload).toEqual({
      service: 'openape-troop',
      version: '0.1.10',
      changelog: '# @openape/troop\n\n## 0.1.10\n',
    })
  })

  it('keeps an empty changelog as valid text', () => {
    expect(buildChangelogPayload('').changelog).toBe('')
  })
})
