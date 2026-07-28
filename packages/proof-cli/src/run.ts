import { runMain } from 'citty'
import type { CommandDef } from 'citty'
import { error } from './output'

/**
 * Run a proof-link CLI: same error handling for every app. Maps the
 * `{ title, detail, status }` shape thrown by `@openape/cli-auth`'s `ApiError`
 * to a clean stderr message + non-zero exit.
 */
export async function runProofCli(main: CommandDef): Promise<void> {
  process.on('unhandledRejection', (err: unknown) => {
    handleError(err)
    process.exit(1)
  })
  try {
    await runMain(main)
  }
  catch (err) {
    handleError(err)
    process.exit(1)
  }
}

function handleError(err: unknown): void {
  if (err && typeof err === 'object') {
    const e = err as { title?: string, detail?: string, message?: string, status?: number }
    const header = e.title ?? e.message ?? 'Unknown error'
    error(e.status ? `${header} (${e.status})` : header)
    if (e.detail) error(e.detail)
    return
  }
  error(String(err))
}
