import { createProblemError } from './problem'

export const MAX_TITLE = 200

export function parseTitle(value: unknown): string {
  const title = typeof value === 'string' ? value.trim() : ''
  if (!title || title.length > MAX_TITLE) {
    throw createProblemError({ status: 400, title: `title must be 1–${MAX_TITLE} chars` })
  }
  return title
}

export function parseValueCents(value: unknown): number {
  if (value === undefined || value === null) return 0
  if (!Number.isInteger(value) || (value as number) < 0 || (value as number) > 1e12) {
    throw createProblemError({ status: 400, title: 'value_cents must be a whole number of cents' })
  }
  return value as number
}
