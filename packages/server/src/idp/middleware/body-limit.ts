import { defineEventHandler } from 'h3'
import { createProblemError } from '../utils/problem.js'

export function createBodyLimitMiddleware(maxBytes: number = 100_000) {
  return defineEventHandler((event) => {
    const contentLength = event.node.req.headers['content-length']
    if (contentLength && Number.parseInt(contentLength) > maxBytes) {
      throw createProblemError({
        status: 413,
        title: 'Request body too large',
        detail: `Content-Length ${contentLength} exceeds maximum of ${maxBytes} bytes.`,
      })
    }
  })
}
