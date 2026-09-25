import type { GrantObserver, GrantLookup } from '../broker/authorization'
import { join } from 'node:path'
import { loadAdapter, resolveCommand } from '@openape/apes'
import type { PodResource } from '../../contracts/resources'
import type { ServiceScope } from '../../contracts/services'
import type { HttpAuthentication, HttpRequest, HttpReply } from '../../contracts/http'
import { parseHttpAuthentication, parseHttpPermission, parseHttpRequest } from '../../contracts/http'
import { AgentAuthority } from '../broker/authorization'
import { PodIdentityManager } from '../connections/agent'
import type { CredentialCache } from '../connections/cache'
import type { ProgramAuthority } from './grants'
import { requestHttp } from './http'

export interface AgentBearer {
  token: (authentication: HttpAuthentication) => Promise<string>
  reject: (authentication: HttpAuthentication) => void
}

function httpResource(resources: PodResource[], scope: Pick<ServiceScope, 'podId' | 'capabilities'>, request: HttpRequest): PodResource {
  const resource = resources.find(item => item.podId === scope.podId && item.kind === 'tool' && item.state === 'ready' && item.configuration.type === 'http' && item.configuration.origin === new URL(request.url).origin && scope.capabilities.includes(String(item.configuration.capability)))
  if (!resource) throw new Error('HTTP destination is not assigned to this script')
  return resource
}

export function assignedHttp(resources: PodResource[], scope: Pick<ServiceScope, 'podId' | 'capabilities'>, request: HttpRequest): ProgramAuthority {
  const resource = httpResource(resources, scope, request)
  parseHttpRequest(request, parseHttpPermission({ origin: resource.configuration.origin, methods: resource.configuration.methods }))
  const authority = resource.configuration.authority as ProgramAuthority | undefined
  if (!authority || authority.identity?.podId !== scope.podId || typeof authority.grantId !== 'string' || !/^[\w-]{1,128}$/.test(authority.grantId)) throw new Error('HTTP permission has no matching pod identity')
  return authority
}

export async function executeHttp(resources: PodResource[], scope: ServiceScope, request: HttpRequest, vendor: string, credentials: CredentialCache, signal: AbortSignal, observe?: GrantObserver, previous?: GrantLookup, bearer?: AgentBearer): Promise<HttpReply> {
  const assignment = assignedHttp(resources, scope, request)
  const configured = httpResource(resources, scope, request).configuration.authentication
  const authentication = configured === undefined ? undefined : parseHttpAuthentication(configured)
  if (authentication && Object.keys(request.headers).some(name => name.toLowerCase() === 'authorization')) throw new Error('This HTTP destination authenticates as its assigned DDISA agent; remove the Authorization header')
  if (authentication && !bearer) throw new Error('DDISA agent authentication is unavailable')
  const identity = new PodIdentityManager(credentials)
  const authority = new AgentAuthority(identity.connection(assignment.identity, `pods:${scope.podId}`), observe, previous)
  const adapterPath = join(vendor, 'pod-http-shapes.toml')
  const adapter = loadAdapter('pod-http', adapterPath)
  const argv = ['pod-http', 'request', '--origin', new URL(request.url).origin, '--method', request.method]
  const resolved = await resolveCommand(adapter, argv)
  const authorization = { grantId: assignment.grantId, command: { cliId: 'pod-http', adapterPath, adapterDigest: adapter.digest, argv, permission: resolved.permission } }
  await authority.authorize(authorization, signal)
  const controller = new AbortController()
  const combined = AbortSignal.any([signal, controller.signal])
  let checking: Promise<void> | undefined
  const timer = setInterval(() => {
    if (checking) return
    checking = authority.assertActive(authorization.grantId, combined).catch(() => { controller.abort(new Error('HTTP permission is no longer active')) }).finally(() => { checking = undefined })
  }, 1000)
  try {
    const token = authentication ? await bearer!.token(authentication) : undefined
    const outgoing = token ? { ...request, headers: { ...request.headers, authorization: `Bearer ${token}` } } : request
    let reply = await requestHttp(outgoing, combined)
    if (token) reply = redact(reply, token)
    if (authentication && reply.status === 401) bearer!.reject(authentication)
    await authority.assertActive(authorization.grantId, combined)
    combined.throwIfAborted()
    return reply
  }
  finally { clearInterval(timer); controller.abort(); await checking }
}

// A destination may echo request headers; the injected token must not reach the script.
function redact(reply: HttpReply, token: string): HttpReply {
  const hide = (value: string) => value.replaceAll(token, '[redacted]')
  return { ...reply, body: hide(reply.body), headers: Object.fromEntries(Object.entries(reply.headers).map(([name, value]) => [name, hide(value)])) }
}
