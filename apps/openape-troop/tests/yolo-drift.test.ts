import { describe, expect, it } from 'vitest'
import { diffTools } from '../server/utils/cockpit/yolo-drift'

describe('diffTools', () => {
  it('meldet keine Drift bei identischen Listen (Reihenfolge egal)', () => {
    expect(diffTools(['a *', 'b'], ['b', 'a *'])).toEqual({ added: [], removed: [] })
  })

  it('added = in den Rollen, aber nicht im letzten Sync', () => {
    expect(diffTools(['a', 'jq *'], ['a'])).toEqual({ added: ['jq *'], removed: [] })
  })

  it('removed = im letzten Sync, aber nicht mehr in den Rollen', () => {
    expect(diffTools(['a'], ['a', 'o365-cli mail send *'])).toEqual({ added: [], removed: ['o365-cli mail send *'] })
  })

  it('leere Rollen-Union gegen alten Sync: alles removed', () => {
    expect(diffTools([], ['a', 'b'])).toEqual({ added: [], removed: ['a', 'b'] })
  })
})
