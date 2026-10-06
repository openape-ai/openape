import { createError } from 'h3'

let initialization: Promise<Error | null> | undefined
export function initializeReportsDatabase(operation: () => Promise<void>) {
  initialization = (async () => {
    try { await operation(); return null }
    catch (error) {
      console.error('Reports database initialization failed; serving is disabled', error)
      return error instanceof Error ? error : new Error(String(error))
    }
  })()
}
export async function requireReportsDatabase() {
  if (!initialization || await initialization) throw createError({ statusCode: 503, statusMessage: 'Reports database recovery is incomplete; service is unavailable' })
}
