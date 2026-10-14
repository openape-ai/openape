import { isAbsolute } from 'node:path'
import type { OpenApeCliAuthorizationDetail } from '@openape/core'
import { cliAuthorizationDetailsCover } from '@openape/grants'
import { exactCommand, loadAdapter, resolveCommand } from '@openape/shapes'
import type { ResolvedCommand } from '@openape/shapes'
import { verifyAndConsume } from './grants'
import type { AssignedGrantScope } from './grants'

export interface AssignedCommand {
  cliId: string
  adapterPath: string
  adapterDigest: string
  argv: string[]
  /** The authorization details of the assigned grant; the command must be covered by them (a whole-program grant covers each of its operations). */
  coverage: OpenApeCliAuthorizationDetail[]
  /** Only a grant for this exact argv authorizes it, for example when the adapter is not a tested registry adapter. */
  exact?: true
}
export async function authorizeAssignedCommand(command: AssignedCommand, token: string, scope: AssignedGrantScope): Promise<ResolvedCommand> {
  if (!isAbsolute(command.adapterPath) || !/^SHA-256:[a-f0-9]{64}$/.test(command.adapterDigest)) throw new Error('An explicitly pinned adapter is required')
  const issuer = new URL(scope.issuer)
  if (issuer.protocol !== 'https:' && !(issuer.protocol === 'http:' && issuer.hostname === '127.0.0.1')) throw new Error('Unsupported identity provider origin')
  for (const endpoint of [scope.jwksUri, scope.grantsEndpoint]) {
    const url = new URL(endpoint)
    if (url.origin !== issuer.origin || url.username || url.password || url.search || url.hash) throw new Error('Identity endpoints must remain on the assigned origin')
  }
  if (!scope.subject || !scope.targetHost || !/^[\w-]{1,128}$/.test(scope.grantId)) throw new Error('Incomplete assigned grant binding')
  if (!Array.isArray(command.coverage) || command.coverage.length < 1 || command.coverage.length > 256) throw new Error('An assigned grant coverage is required')
  if (command.argv.length < 1 || command.argv.length > 100 || command.argv.some(argument => typeof argument !== 'string' || argument.length > 4096 || argument.includes('\0'))) throw new Error('Invalid assigned command arguments')
  const adapter = loadAdapter(command.cliId, command.adapterPath)
  if (adapter.digest !== command.adapterDigest) throw new Error('Assigned adapter integrity mismatch')
  const structured = await resolveCommand(adapter, command.argv)
  const resolved = command.exact ? exactCommand(structured) : structured
  if (resolved.detail.operation_id === '_generic.exec' || !cliAuthorizationDetailsCover(command.coverage, [resolved.detail])) throw new Error('Command is outside the assigned operation')
  await verifyAndConsume(token, resolved, command.exact ? { ...scope, exactCommand: true } : scope)
  return resolved
}
