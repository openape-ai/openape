export const NOTE_KINDS = ['mail', 'notiz', 'aufgabe', 'termin', 'dokument'] as const

export type NoteKind = typeof NOTE_KINDS[number]

export function isNoteKind(value: unknown): value is NoteKind {
  return typeof value === 'string' && (NOTE_KINDS as readonly string[]).includes(value)
}

export function parseNoteKind(value: unknown): NoteKind {
  if (value === undefined || value === null || value === '') return 'notiz'
  if (!isNoteKind(value)) throw new Error('unknown kind')
  return value
}

export function parseNoteTitle(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) return 'Notiz'
  return value.trim().slice(0, 200)
}
