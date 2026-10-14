/**
 * Mail moves belong to owner approvals: a command the IdP resolves to one of these actions runs only through the approved
 * archive service (context.mail.archiveApproved), bound to one approved message. A whole-program grant never covers
 * it, and scripts, agents and terminals cannot call it, whatever grant the Pod holds.
 */
export const gateActions: readonly string[] = ['move', 'archive']
/**
 * The mail programs that have an archive port: the o365 CLI (registry name `o365`, assigned as `o365-cli`), whose
 * workflow move runs through mail.archiveApproved, and the pods-mail companion of mail.archive.
 */
export const archivePortPrograms: readonly string[] = ['o365', 'o365-cli', 'pods-mail']
/**
 * What a call of such a program may do outside its archive port, as the IdP resolved it: reads and the known effects
 * that never move mail. Anything else, including a generic exact-command action, is refused (fail closed).
 */
export const mailProgramActions: readonly string[] = ['read', 'list', 'get', 'search', 'categorize', 'configure', 'login']
export function assertGateOperation(action: string, port?: string): void {
  if (gateActions.includes(action) && port !== action) throw new Error('Moving or archiving mail runs only through the approved archive service')
}

/** The archive service's only write: one approved message from its current folder into the mailbox Archive folder. */
export function assertArchiveMove(argv: string[]): void {
  const values = ['--account', '--message', '--expected-version', '--source-folder'].map((flag, index) => argv[2 + index * 2] === flag ? argv[3 + index * 2] : undefined)
  if (argv.length !== 12 || argv[0] !== 'workflow' || argv[1] !== 'move' || argv[10] !== '--destination' || argv[11] !== 'archive' || values.some(value => typeof value !== 'string' || !value || value.startsWith('-'))) throw new Error('The archive service only moves one message into the Archive folder')
}

/** Prefix of a broker refusal that happened before anything was sent to the mail provider. */
export const archiveNotStarted = 'Archive move not started'
export function archiveRefusal(error: unknown): Error {
  return new Error(`Archive move not started: ${error instanceof Error ? error.message : 'refused'}`)
}
