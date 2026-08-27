import { describe, expect, it } from 'vitest'
import { isNoteKind, parseNoteKind, parseNoteTitle } from '../server/utils/notes'

describe('note kind', () => {
  it('defaults to notiz', () => {
    expect(parseNoteKind(undefined)).toBe('notiz')
    expect(parseNoteTitle(undefined)).toBe('Notiz')
  })

  it('accepts historie kinds', () => {
    expect(isNoteKind('mail')).toBe(true)
    expect(parseNoteKind('termin')).toBe('termin')
  })

  it('rejects unknown kinds', () => {
    expect(isNoteKind('foto')).toBe(false)
    expect(() => parseNoteKind('foto')).toThrow()
  })
})
