import type { AgentConnection, GrantObserver, GrantLedgerPort, RunGrantTokens } from '../broker/authorization'
import { join } from 'node:path'
import { loadAdapter, resolveCommand } from '@openape/apes'
import type { PodResource } from '../../contracts/resources'
import type { ServiceScope } from '../../contracts/services'
import type { HttpAuthentication, HttpRequest, HttpReply } from '../../contracts/http'
import { parseHttpAuthentication, parseHttpPermission, parseHttpRequest } from '../../contracts/http'
import { AgentAuthority } from '../broker/authorization'
import { httpArgv } from '../grants/execution-context'
import { requestHttp } from './http'

export interface AgentBearer {
  token: (authentication: HttpAuthentication, origin: string) => Promise<string>
  reject: (authentication: HttpAuthentication) => void
}

function httpResource(resources: PodResource[], scope: Pick<ServiceScope, 'podId' | 'capabilities'>, request: HttpRequest): PodResource {
  const resource = resources.find(item => item.podId === scope.podId && item.kind === 'tool' && item.state === 'ready' && item.configuration.type === 'http' && item.configuration.origin === new URL(request.url).origin && scope.capabilities.includes(String(item.configuration.capability)))
  if (!resource) throw new Error('HTTP destination is not assigned to this script')
  return resource
}

/** The HTTP sandbox: the destination must be assigned with this origin and method and declared by the script. */
export function assignedHttp(resources: PodResource[], scope: Pick<ServiceScope, 'podId' | 'capabilities'>, request: HttpRequest): PodResource {
  const resource = httpResource(resources, scope, request)
  parseHttpRequest(request, parseHttpPermission({ origin: resource.configuration.origin, methods: resource.configuration.methods }))
  return resource
}

/** Sends one request inside the sandbox; the Pod identity needs a grant that covers this origin and method. */
export async function executeHttp(resources: PodResource[], scope: ServiceScope, request: HttpRequest, vendor: string, connection: AgentConnection, signal: AbortSignal, observe?: GrantObserver, ledger?: GrantLedgerPort, bearer?: AgentBearer, tokens?: RunGrantTokens): Promise<HttpReply> {
  const configured = assignedHttp(resources, scope, request).configuration.authentication
  const authentication = configured === undefined ? undefined : parseHttpAuthentication(configured)
  if (authentication && Object.keys(request.headers).some(name => name.toLowerCase() === 'authorization')) throw new Error('This HTTP destination authenticates as its assigned DDISA agent; remove the Authorization header')
  if (authentication && !bearer) throw new Error('DDISA agent authentication is unavailable')
  const authority = new AgentAuthority(connection, observe, ledger, tokens)
  const adapterPath = join(vendor, 'pod-http-shapes.toml')
  const adapter = loadAdapter('pod-http', adapterPath)
  const argv = httpArgv(new URL(request.url).origin, request.method)
  const resolved = await resolveCommand(adapter, argv)
  const authorization = { grantId: '', command: { cliId: 'pod-http', adapterPath, adapterDigest: adapter.digest, argv, coverage: [resolved.detail] } }
  await authority.authorize(authorization, signal)
  const token = authentication ? await bearer!.token(authentication, new URL(request.url).origin) : undefined
  const outgoing = token ? { ...request, headers: { ...request.headers, authorization: `Bearer ${token}` } } : request
  signal.throwIfAborted()
  let reply = await requestHttp(outgoing, signal)
  if (token) reply = redact(reply, token)
  if (authentication && reply.status === 401) bearer!.reject(authentication)
  return reply
}

// A destination may echo request headers; the injected token must not reach the script.
function redact(reply: HttpReply, token: string): HttpReply {
  const hide = (value: string) => value.replaceAll(token, '[redacted]')
  return { ...reply, body: hide(reply.body), headers: Object.fromEntries(Object.entries(reply.headers).map(([name, value]) => [name, hide(value)])) }
}
