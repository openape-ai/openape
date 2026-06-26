// Output helpers — now sourced from @openape/proof-cli (shared across all
// proof-link CLIs). Re-exported here so command modules keep importing from
// `../output.ts` unchanged.
export { error, fmtTime, info, printJson, printLine, printNdjson } from '@openape/proof-cli'
export type { OutputOptions } from '@openape/proof-cli'
