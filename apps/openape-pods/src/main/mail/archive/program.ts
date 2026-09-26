import { createHash } from 'node:crypto'
import { loadAdapter, resolveCommand } from '@openape/apes'
import type { PodResource } from '../../../contracts/resources'
import type { ArchiveManifest } from '../../../contracts/mail-archive'
import { parseArchiveMail } from '../../../contracts/mail-archive'
import type { ProgramAssignment } from '../../../contracts/programs'
import type { CredentialCache } from '../../connections/cache'
import type { BrokerLease, ToolReply } from '../../broker/tools'
import { PodToolBroker } from '../../broker/tools'
import { programRequest } from '../../programs/invoke'
import { programLaunch, verifyProgramRuntime } from '../../programs/runtime'
import { verifyExecutable } from '../../../worker/runtime/sandbox'
import { startMailProxy } from '../proxy'
import type { ArchiveProvider } from './service'

export function archiveApplication(resources: PodResource[], podId: string, capabilities: string[], application: string) {
  const selected = programRequest(resources, podId, capabilities, { application, argv: ['list'] })
  if (selected.assignment.cliId !== 'pods-mail') throw new Error('Assign the reviewed pods-mail companion before using archive approvals')
  return selected
}
export function archiveApplicationHash(assignment: ProgramAssignment): string {
  const { grants: _grants, ...definition } = assignment
  return createHash('sha256').update(JSON.stringify(definition)).digest('hex')
}
interface ProviderServices {
  read: (argv: string[]) => Promise<unknown>
  move: (argv: string[]) => Promise<unknown>
}
export function archiveProvider(applicationId: string, assignment: ProgramAssignment, mailbox: string, services: ProviderServices): ArchiveProvider {
  function response(value: unknown, operation: string): Record<string, unknown> {
    const result = value as ToolReply
    if (!result || result.exitCode !== 0 || typeof result.stdout !== 'string') throw new Error(`Mail ${operation} failed; inspect the assigned program`)
    const reply = JSON.parse(result.stdout) as Record<string, unknown>
    if (reply.protocol !== 'pods-mail-review/v1' || reply.account !== mailbox || reply.operation !== operation) throw new Error('Mail provider response changed account or operation')
    return reply
  }
  return {
    applicationId, applicationHash: archiveApplicationHash(assignment),
    async read(id) {
      const reply = response(await services.read(['read', '--account', mailbox, '--message', id]), 'read')
      return reply.message === null ? null : parseArchiveMail(reply.message)
    },
    async move(mail) {
      const reply = response(await services.move(['archive', '--account', mailbox, '--message', mail.id, '--version', mail.version, '--folder', mail.folder]), 'archive')
      if (reply.state === 'skipped' && typeof reply.reason === 'string') return { state: 'skipped', reason: reply.reason }
      if (reply.state !== 'archived') throw new Error('Provider did not confirm archival; inspect mailbox before retrying')
      return { state: 'archived', receipt: parseArchiveMail(reply.message) }
    },
  }
}
export async function moveApprovedMail(input: { resources: PodResource[], manifest: ArchiveManifest, argv: string[], helper: string, root: string, credentials: CredentialCache, lease: BrokerLease, assertAuthority: () => Promise<void> }): Promise<ToolReply> {
  const { manifest, argv, lease } = input
  const selected = programRequest(input.resources, manifest.podId, lease.capabilities, { applicationId: manifest.applicationId, argv })
  const assignment = selected.assignment
  const item = manifest.items.find(mail => JSON.stringify(argv) === JSON.stringify(['archive', '--account', manifest.mailbox, '--message', mail.id, '--version', mail.version, '--folder', mail.folder]))
  if (!item || assignment.cliId !== 'pods-mail' || archiveApplicationHash(assignment) !== manifest.applicationHash) throw new Error('Move is outside the frozen archive batch')
  await verifyExecutable(assignment.executable, assignment.executableHash)
  await verifyExecutable(assignment.adapterPath, assignment.adapterHash)
  await verifyProgramRuntime(assignment)
  const adapter = loadAdapter(assignment.cliId, assignment.adapterPath)
  const command = [assignment.cliId, ...argv]
  const resolved = await resolveCommand(adapter, command)
  if (resolved.detail.operation_id !== 'archive' || resolved.detail.action !== 'archive') throw new Error('Assigned mail archive operation changed')
  const proxy = await startMailProxy(lease.signal, undefined, assignment.networkHosts)
  try {
    const authority = { authorize: async () => input.assertAuthority(), assertActive: async () => input.assertAuthority() }
    const broker = new PodToolBroker(input.helper, input.root, authority, input.credentials)
    const launch = programLaunch(assignment)
    return await broker.execute({ id: selected.id, capability: assignment.capability, grantId: manifest.id, command: { cliId: assignment.cliId, adapterPath: assignment.adapterPath, adapterDigest: adapter.digest, argv: command, permission: resolved.permission }, executable: launch.executable, executableHash: launch.executableHash, entryFiles: assignment.entryFiles, prefix: launch.prefix, programState: { id: assignment.stateId, podId: manifest.podId, applicationId: selected.id }, runtimeDirectories: launch.runtimeDirectories, runtimeEnvironment: assignment.runtime?.environment, environment: { ...assignment.environment, ...proxy.environment }, networkPorts: [proxy.port], maxOutputBytes: 200000 }, { toolId: selected.id, argv: command }, lease)
  }
  finally { await proxy.close() }
}
