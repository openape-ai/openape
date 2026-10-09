import type { NetworkDefinition, NetworkMember } from './networks'
import { networkApprovals } from './networks'

/**
 * A consumer that receives only owner-approved gate outputs and holds exactly one mail application (and no mailbox read)
 * is the archive member. Its script and agent cannot invoke that application; only the archive port uses it for each
 * approved item.
 */
export function networkArchiveMember(definition: NetworkDefinition, member: NetworkMember, capabilities: string[]): boolean {
  const applications = capabilities.filter(capability => capability === 'mail.read' || /^tool\.app_[a-f0-9]{32}\.invoke$/.test(capability))
  return !member.source && member.contract.takes.length > 0 && applications.length === 1 && applications[0]!.startsWith('tool.app_')
    && member.contract.takes.every(channel => networkApprovals(definition).some(approval => approval.podId === member.podId && approval.gives === channel))
}

/** The archive port's only write: one approved message from its current folder into the mailbox Archive folder. */
export function assertArchiveMove(argv: string[]): void {
  const values = ['--account', '--message', '--expected-version', '--source-folder'].map((flag, index) => argv[2 + index * 2] === flag ? argv[3 + index * 2] : undefined)
  if (argv.length !== 12 || argv[0] !== 'workflow' || argv[1] !== 'move' || argv[10] !== '--destination' || argv[11] !== 'archive' || values.some(value => typeof value !== 'string' || !value || value.startsWith('-'))) throw new Error('The archive port only moves one message into the Archive folder')
}

/** Prefix of a broker refusal that happened before anything was sent to the mail provider. */
export const archiveNotStarted = 'Archive move not started'
export function archiveRefusal(error: unknown): Error {
  return new Error(`Archive move not started: ${error instanceof Error ? error.message : 'refused'}`)
}
