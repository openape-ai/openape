import { createError } from 'h3'

/**
 * Thin wrapper around h3's createError matching the RFC 7807 Problem-style
 * shape used across the OpenApe stack: status + title (+ optional detail).
 */
export function createProblemError(opts: {
  status: number
  title: string
  detail?: string
}) {
  return createError({
    statusCode: opts.status,
    statusMessage: opts.title,
    data: { title: opts.title, ...(opts.detail ? { detail: opts.detail } : {}) },
  })
}
