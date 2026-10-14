import type { OpenApeCliAuthorizationDetail } from '@openape/core'
import { canonicalizeCliPermission } from '@openape/grants'

/**
 * The permissions the desktop requests for its own operations: running a Pod's stored script, an HTTPS request to an
 * assigned origin and an SSH inventory. They are plain permission grants (issue 1473, revision 4): the desktop builds
 * their fixed authorization detail itself, with the permission strings of the shapes-registry entries `pod-runtime`,
 * `pod-http` and `pod-ssh`, so grants approved before keep matching. Program calls never use them.
 */
export interface PodPermission { detail: OpenApeCliAuthorizationDetail, argv: string[] }

/** The run of a stored Pod script; a run adds its home and visible environment. */
export interface RuntimeRun { podId: string, name: string, script: string, workspace: string, home?: string, environment?: Record<string, string> }

/** The pod-runtime command a run starts, and the command its runtime grant is requested for. */
export function runtimeArgv(run: RuntimeRun): string[] {
  return ['pod-runtime', 'run', '--pod', run.podId, '--name', run.name, '--script', run.script, '--workspace', run.workspace, ...(run.home ? ['--home', run.home] : []), ...(run.environment ? ['--environment', JSON.stringify(run.environment)] : [])]
}

/** The pod-http command of one request, and the command its HTTP or Jev grant is requested for. */
export function httpArgv(origin: string, method: string): string[] {
  return ['pod-http', 'request', '--origin', origin, '--method', method]
}

type DetailFields = Omit<OpenApeCliAuthorizationDetail, 'type' | 'permission'>
function permissionDetail(fields: DetailFields): OpenApeCliAuthorizationDetail {
  const detail = { type: 'openape_cli' as const, ...fields, permission: '' }
  return { ...detail, permission: canonicalizeCliPermission(detail) }
}

/** Running any stored script of one Pod, whatever its script, workspace or name. */
export function runtimePermission(run: RuntimeRun): PodPermission {
  return { argv: runtimeArgv(run), detail: permissionDetail({ cli_id: 'pod-runtime', operation_id: 'run', resource_chain: [{ resource: 'pod', selector: { id: run.podId } }], action: 'run', display: `Run the stored script of ${run.name}`, risk: 'high' }) }
}

/** One HTTP method of one HTTPS origin. */
export function httpPermission(origin: string, method: string): PodPermission {
  return { argv: httpArgv(origin, method), detail: permissionDetail({ cli_id: 'pod-http', operation_id: 'request', resource_chain: [{ resource: 'https-origin', selector: { url: origin } }, { resource: 'http-method', selector: { name: method } }], action: 'request', display: `HTTP ${method} to ${origin}`, risk: 'high' }) }
}

/** Every HTTP method of one HTTPS origin; it covers each single-method permission of that origin. */
export function originPermission(origin: string): PodPermission {
  return { argv: ['pod-http'], detail: permissionDetail({ cli_id: 'pod-http', operation_id: 'request', resource_chain: [{ resource: 'https-origin', selector: { url: origin } }], action: 'request', display: `HTTP requests to ${origin}`, risk: 'high' }) }
}

/** The fixed inventory profile of one reviewed SSH binding; `argv` is sshGrantArgv of that binding. */
export function sshPermission(argv: string[]): PodPermission {
  const [executable, operation, bindingFlag, binding, profileFlag, profile] = argv
  if (argv.length !== 6 || executable !== 'pod-ssh' || operation !== 'inventory' || bindingFlag !== '--binding' || profileFlag !== '--profile' || !binding || !profile) throw new Error('Invalid SSH inventory permission')
  return { argv, detail: permissionDetail({ cli_id: 'pod-ssh', operation_id: 'inventory', resource_chain: [{ resource: 'ssh-binding', selector: { hash: binding } }, { resource: 'inventory-profile', selector: { name: profile } }], action: 'read', display: `Read fixed SSH inventory ${profile} for reviewed binding ${binding}`, risk: 'low' }) }
}
