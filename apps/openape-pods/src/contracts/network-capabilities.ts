import type { NetworkDefinition, NetworkMember } from './networks'
import { networkGateOutput } from './networks'

export function supportedNetworkCapability(capability: string): boolean {
  return capability === 'mail.read' || capability === 'jev.evaluate' || /^tool\.app_[a-f0-9]{32}\.invoke$/.test(capability)
}

export function networkSourceCapability(capability: string): boolean {
  return capability === 'mail.read' || /^tool\.app_[a-f0-9]{32}\.invoke$/.test(capability)
}

/**
 * A consumer that receives only owner-approved gate outputs may hold exactly one assigned mail application. Its script
 * cannot invoke it; only the archive port uses it for each approved item.
 */
export function networkArchiveMember(definition: NetworkDefinition, member: NetworkMember, capabilities: string[]): boolean {
  const applications = capabilities.filter(networkSourceCapability)
  return !member.source && member.contract.takes.length > 0 && applications.length === 1 && applications[0]!.startsWith('tool.app_')
    && member.contract.takes.every(channel => definition.gates?.some(gate => gate.podId === member.podId && networkGateOutput(definition, gate.key, gate.channel) === channel))
}

/** The archive port's only write: one approved message from its current folder into the mailbox Archive folder. */
export function assertArchiveMove(argv: string[]): void {
  const values = ['--account', '--message', '--expected-version', '--source-folder'].map((flag, index) => argv[2 + index * 2] === flag ? argv[3 + index * 2] : undefined)
  if (argv.length !== 12 || argv[0] !== 'workflow' || argv[1] !== 'move' || argv[10] !== '--destination' || argv[11] !== 'archive' || values.some(value => typeof value !== 'string' || !value || value.startsWith('-'))) throw new Error('The archive port only moves one message into the Archive folder')
}
