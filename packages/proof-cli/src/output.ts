// Output helpers shared by all proof-link CLIs. Re-exports the stdout helpers
// from @openape/cli-auth and adds the stderr helpers (info/error) that the
// command bodies use.
export { fmtTime, printJson, printLine, printNdjson } from '@openape/cli-auth'

export interface OutputOptions {
  json?: boolean
  quiet?: boolean
}

export function info(msg: string, opts: OutputOptions = {}): void {
  if (opts.quiet) return
  process.stderr.write(`${msg}\n`)
}

export function error(msg: string): void {
  process.stderr.write(`error: ${msg}\n`)
}
