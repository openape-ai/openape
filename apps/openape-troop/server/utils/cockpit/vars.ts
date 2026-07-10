import type { Vars } from './tree'
import { createError } from 'h3'

// `vars` arrives from the browser, so it is validated, not trusted. A plain
// JSON object only: arrays and scalars would silently break the merge in
// buildOrgTree (spreading an array yields numeric keys).
export function assertVars(value: unknown): Vars {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw createError({ statusCode: 400, statusMessage: 'vars must be a JSON object' })
  }
  return value as Vars
}
