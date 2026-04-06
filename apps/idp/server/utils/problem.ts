import { createProblemDetails } from '@openape/core'

export function createProblemError(opts: {
  type?: string
  title: string
  status: number
  detail?: string
}) {
  const problem = createProblemDetails(opts)
  return createError({
    statusCode: opts.status,
    statusMessage: opts.title,
    data: problem,
  })
}
