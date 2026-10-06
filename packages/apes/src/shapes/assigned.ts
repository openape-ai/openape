import { isAbsolute } from 'node:path'
import { loadAdapter, resolveCommand } from '@openape/shapes'
import type { ResolvedCommand } from '@openape/shapes'
import { verifyAndConsume } from './grants'
import type { AssignedGrantScope } from './grants'

export interface AssignedCommand {
  cliId: string
  adapterPath: string
  adapterDigest: string
  argv: string[]
  permission: string
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
  if (command.argv.length < 1 || command.argv.length > 100 || command.argv.some(argument => typeof argument !== 'string' || argument.length > 4096 || argument.includes('\0'))) throw new Error('Invalid assigned command arguments')
  const adapter = loadAdapter(command.cliId, command.adapterPath)
  if (adapter.digest !== command.adapterDigest) throw new Error('Assigned adapter integrity mismatch')
  const resolved = await resolveCommand(adapter, command.argv)
  if (resolved.permission !== command.permission || resolved.detail.operation_id === '_generic.exec') throw new Error('Command is outside the assigned operation')
  await verifyAndConsume(token, resolved, scope)
  return resolved
}
