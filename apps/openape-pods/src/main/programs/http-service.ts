import { join } from 'node:path'
import { loadAdapter, resolveCommand } from '@openape/apes'
import type { PodResource } from '../../contracts/resources'
import type { ServiceScope } from '../../contracts/services'
import type { HttpRequest, HttpReply } from '../../contracts/http'
import { parseHttpPermission, parseHttpRequest } from '../../contracts/http'
import { AgentAuthority } from '../broker/authorization'
import { PodIdentityManager } from '../connections/agent'
import type { CredentialCache } from '../connections/cache'
import type { ProgramAuthority } from './grants'
import { requestHttp } from './http'

export function assignedHttp(resources: PodResource[], scope: Pick<ServiceScope, 'podId' | 'capabilities'>, request: HttpRequest): ProgramAuthority {
  const resource = resources.find(item => item.podId === scope.podId && item.kind === 'tool' && item.state === 'ready' && item.configuration.type === 'http' && item.configuration.origin === new URL(request.url).origin && scope.capabilities.includes(String(item.configuration.capability)))
  if (!resource) throw new Error('HTTP destination is not assigned to this script')
  parseHttpRequest(request, parseHttpPermission({ origin: resource.configuration.origin, methods: resource.configuration.methods }))
  const authority = resource.configuration.authority as ProgramAuthority | undefined
  if (!authority || authority.identity?.podId !== scope.podId || typeof authority.grantId !== 'string' || !/^[\w-]{1,128}$/.test(authority.grantId)) throw new Error('HTTP permission has no matching pod identity')
  return authority
}

export async function executeHttp(resources: PodResource[], scope: ServiceScope, request: HttpRequest, vendor: string, credentials: CredentialCache, signal: AbortSignal): Promise<HttpReply> {
  const assignment = assignedHttp(resources, scope, request)
  const identity = new PodIdentityManager(credentials)
  const authority = new AgentAuthority(identity.connection(assignment.identity, `pods:${scope.podId}`))
  const adapterPath = join(vendor, 'pod-http-shapes.toml')
  const adapter = loadAdapter('pod-http', adapterPath)
  const argv = ['pod-http', 'request', '--origin', new URL(request.url).origin, '--method', request.method]
  const resolved = await resolveCommand(adapter, argv)
  await authority.authorize({ grantId: assignment.grantId, command: { cliId: 'pod-http', adapterPath, adapterDigest: adapter.digest, argv, permission: resolved.permission } }, signal)
  const controller = new AbortController()
  const combined = AbortSignal.any([signal, controller.signal])
  let checking: Promise<void> | undefined
  const timer = setInterval(() => {
    if (checking) return
    checking = authority.assertActive(assignment.grantId, combined).catch(() => { controller.abort(new Error('HTTP permission is no longer active')) }).finally(() => { checking = undefined })
  }, 1000)
  try {
    const reply = await requestHttp(request, combined)
    await authority.assertActive(assignment.grantId, combined)
    combined.throwIfAborted()
    return reply
  }
  finally { clearInterval(timer); controller.abort(); await checking }
}
