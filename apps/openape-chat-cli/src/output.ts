// Output helpers now live in @openape/cli-auth. Re-export so existing
// command imports (`from '../output'`) remain valid without change.
export { fmtTime, printJson, printLine, printNdjson } from '@openape/cli-auth'
