import type { OpenApeGrantRequest } from '@openape/core'

export interface PodRunPresentation { podId: string, name: string, script: string, workspace: string, environment: Record<string, string> }
export function podRunPresentation(request?: OpenApeGrantRequest): PodRunPresentation | null {
  if (request?.audience !== 'shapes' || request.authorization_details?.length !== 1) return null
  const detail = request.authorization_details[0]
  if (!detail || detail.type !== 'openape_cli' || detail.cli_id !== 'pod-runtime' || detail.operation_id !== 'run' || detail.action !== 'run' || !Array.isArray(detail.resource_chain) || detail.resource_chain.length !== 1) return null
  const resource = detail.resource_chain[0]
  const podId = resource?.selector?.id
  if (resource?.resource !== 'pod' || !podId || !/^[a-f0-9-]{36}$/.test(podId) || Object.keys(resource.selector ?? {}).length !== 1 || request.target_host !== `pods:${podId}` || detail.permission !== `pod-runtime.pod[id=${podId}]#run`) return null
  const bindings = request.execution_context?.context_bindings
  if (!bindings || bindings.pod !== podId || !bindings.name || !bindings.script || !bindings.workspace) return null
  if ([bindings.name, bindings.script, bindings.workspace].some(value => typeof value !== 'string' || value.length > 4096)) return null
  let environment: Record<string, string> = {}
  if (bindings.environment) {
    if (typeof bindings.environment !== 'string' || bindings.environment.length > 16000) return null
    try { environment = JSON.parse(bindings.environment) as Record<string, string> }
    catch { return null }
    if (!environment || typeof environment !== 'object' || Array.isArray(environment) || Object.entries(environment).some(([key, value]) => !['HOME', 'TMPDIR', 'PATH', 'SHELL', 'PODS_POD_ID', 'LANG', 'TERM', 'ELECTRON_RUN_AS_NODE'].includes(key) || typeof value !== 'string' || value.length > 4096)) return null
  }
  return { podId, name: bindings.name, script: bindings.script, workspace: bindings.workspace, environment }
}
