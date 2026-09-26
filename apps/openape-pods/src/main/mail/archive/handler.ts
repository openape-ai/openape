import { join } from 'node:path'
import type { ServiceScope } from '../../../contracts/services'
import type { ResourceState } from '../../../contracts/resources'
import type { ArchiveRecord } from '../../../contracts/mail-archive'
import { parseArchiveProposal } from '../../../contracts/mail-archive'
import type { CredentialCache } from '../../connections/cache'
import type { ConnectionManager } from '../../connections/manager'
import type { GrantLookup, GrantObserver } from '../../broker/authorization'
import { invokeProgram } from '../../programs/invoke'
import { podWorkspace } from '../../programs/console'
import { assignedDirectories, directoryPolicy } from '../../../runtime/directories'
import { archiveApplication, archiveProvider, moveApprovedMail } from './program'
import { createArchiveAuthority } from './authority'
import type { MailArchiveService } from './service'

interface Request {
  service: MailArchiveService
  body: unknown
  scope: ServiceScope
  root: string
  helper: string
  credentials: CredentialCache
  connections: ConnectionManager
  check: (domain?: { path: string, ownerPid: number }) => Promise<ResourceState>
  signal: AbortSignal
  observe: GrantObserver
  previous: GrantLookup
}
export async function handleMailArchive(input: Request): Promise<unknown> {
  const { scope, signal, check, service } = input
  const body = input.body as { operation: string, proposal?: unknown }
  if (!body || typeof body !== 'object' || Array.isArray(body) || !['prepare', 'process'].includes(body.operation) || Object.keys(body).some(key => !['operation', ...(body.operation === 'prepare' ? ['proposal'] : [])].includes(key))) throw new Error('Invalid archive operation')
  return service.run(scope.podId, async () => {
    const connection = await input.connections.podConnection(scope.podId)
    const authority = createArchiveAuthority(connection, signal, check)
    const state = await check()
    const workspace = await podWorkspace(input.root, scope.podId)
    const directories = directoryPolicy(await assignedDirectories(input.root, scope.podId, state.resources))
    const lease = { ...directories, workspace, capabilities: scope.capabilities, signal, assertCurrent: () => signal.throwIfAborted(), registerDomain: async (path: string, ownerPid: number) => { await check({ path, ownerPid }); signal.throwIfAborted() } }
    const root = join(input.root, 'runs', scope.runId)
    function provider(application: string, mailbox: string, record?: ArchiveRecord) {
      const selected = archiveApplication(state.resources, scope.podId, scope.capabilities, application)
      return archiveProvider(selected.id, selected.assignment, mailbox, {
        read: async (argv) => {
          const current = await check()
          const grant = await input.connections.existingProgramGrant(scope.podId, selected.assignment, argv)
          const resources = current.resources.map(item => item.id === selected.id ? { ...item, configuration: { ...item.configuration, grants: [...selected.assignment.grants.filter(item => item.permission !== grant.permission), grant] } } : item)
          return invokeProgram(resources, scope.podId, { applicationId: selected.id, argv }, input.helper, root, input.credentials, lease, input.observe, input.previous)
        },
        move: async (argv) => {
          if (!record) throw new Error('Preparation cannot move mail')
          const current = await check()
          return moveApprovedMail({ resources: current.resources, manifest: record.manifest, argv, helper: input.helper, root, credentials: input.credentials, lease, assertAuthority: async () => authority.assertActive(record) })
        },
      })
    }
    if (body.operation === 'prepare') {
      const proposal = parseArchiveProposal(body.proposal)
      return service.prepare(scope.podId, proposal, provider(proposal.application, proposal.mailbox), authority)
    }
    return service.process(scope.podId, async (record) => {
      const resource = state.resources.find(item => item.id === record.manifest.applicationId)
      if (!resource) throw new Error('The approved mail application is no longer assigned')
      return provider(resource.name, record.manifest.mailbox, record)
    }, authority)
  })
}
