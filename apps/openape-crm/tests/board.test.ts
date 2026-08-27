import { describe, expect, it } from 'vitest'
import { formatEuro, idToSelection, NO_SELECTION, selectionToId } from '../app/utils/board'

describe('formatEuro', () => {
  it('renders cents as whole euros', () => {
    expect(formatEuro(500000)).toContain('5.000')
    expect(formatEuro(0)).toContain('0')
  })
})

describe('selection sentinel', () => {
  it('never uses an empty string as an option value', () => {
    expect(NO_SELECTION).not.toBe('')
  })

  it('maps the sentinel back to null at the API boundary', () => {
    expect(selectionToId(NO_SELECTION)).toBeNull()
    expect(selectionToId('')).toBeNull()
    expect(selectionToId('01M08K3EW5NYFW8652SQXEKJY1')).toBe('01M08K3EW5NYFW8652SQXEKJY1')
  })

  it('shows the sentinel for a record without a link', () => {
    expect(idToSelection(null)).toBe(NO_SELECTION)
    expect(idToSelection(undefined)).toBe(NO_SELECTION)
    expect(idToSelection('01M08K3EW5NYFW8652SQXEKJY1')).toBe('01M08K3EW5NYFW8652SQXEKJY1')
  })
})
