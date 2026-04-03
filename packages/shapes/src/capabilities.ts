import type { OpenApeCliAuthorizationDetail, OpenApeCliResourceRef } from '@openape/core'
import { canonicalizeCliPermission } from '@openape/grants'
import type { LoadedAdapter, ResolvedCapability, ShapesOperation } from './types.js'

interface ParsedOperationChainEntry {
  resource: string
  selectorKeys: string[]
}

function parseOperationChainEntry(entry: string): ParsedOperationChainEntry {
  const [resource, selectorSpec = '*'] = entry.split(':', 2)
  if (!resource) {
    throw new Error(`Invalid resource chain entry: ${entry}`)
  }

  if (selectorSpec === '*') {
    return { resource, selectorKeys: [] }
  }

  const selectorKeys = selectorSpec.split(',')
    .map((segment) => {
      const [key] = segment.split('=', 2)
      if (!key)
        throw new Error(`Invalid selector segment: ${segment}`)
      return key
    })

  return { resource, selectorKeys }
}

function operationChain(operation: ShapesOperation): ParsedOperationChainEntry[] {
  return operation.resource_chain.map(parseOperationChainEntry)
}

function knownSelectorKeys(operations: ShapesOperation[], resource: string): string[] {
  const keys = new Set<string>()
  for (const operation of operations) {
    for (const entry of operationChain(operation)) {
      if (entry.resource !== resource)
        continue
      for (const key of entry.selectorKeys) {
        keys.add(key)
      }
    }
  }
  return Array.from(keys).sort()
}

function parseResourceSelector(raw: string): { resource: string, key: string, value: string } {
  const [lhs, value] = raw.split('=', 2)
  if (!lhs || !value) {
    throw new Error(`Invalid selector: ${raw}`)
  }

  const [resource, key] = lhs.split('.', 2)
  if (!resource || !key) {
    throw new Error(`Selectors must be in resource.key=value form: ${raw}`)
  }

  return { resource, key, value }
}

function formatSelector(selector?: Record<string, string>): string {
  if (!selector || Object.keys(selector).length === 0)
    return '*'
  return Object.entries(selector)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join(',')
}

function summarizeDetail(detail: OpenApeCliAuthorizationDetail): string {
  const chain = detail.resource_chain
    .map(resource => `${resource.resource}[${formatSelector(resource.selector)}]`)
    .join(' -> ')
  return `Allow ${detail.action} on ${detail.cli_id} ${chain}`
}

export function resolveCapabilityRequest(
  loaded: LoadedAdapter,
  params: {
    resources: string[]
    selectors?: string[]
    actions: string[]
  },
): ResolvedCapability {
  if (params.resources.length === 0) {
    throw new Error('At least one --resource is required')
  }
  if (params.actions.length === 0) {
    throw new Error('At least one --action is required')
  }

  const selectorMap = new Map<string, Record<string, string>>()
  for (const rawSelector of params.selectors ?? []) {
    const { resource, key, value } = parseResourceSelector(rawSelector)
    const current = selectorMap.get(resource) ?? {}
    current[key] = value
    selectorMap.set(resource, current)
  }

  const resource_chain: OpenApeCliResourceRef[] = params.resources.map((resource) => {
    const selector = selectorMap.get(resource)
    const knownKeys = knownSelectorKeys(loaded.adapter.operations, resource)
    if (selector) {
      for (const key of Object.keys(selector)) {
        if (!knownKeys.includes(key)) {
          throw new Error(`Unknown selector ${resource}.${key} for adapter ${loaded.adapter.cli.id}`)
        }
      }
    }
    return selector && Object.keys(selector).length > 0 ? { resource, selector } : { resource }
  })

  const requestedSequence = params.resources.join('\0')
  const matchingOperations = loaded.adapter.operations.filter((operation) => {
    const sequence = operationChain(operation).map(entry => entry.resource).join('\0')
    return sequence === requestedSequence || sequence.startsWith(requestedSequence + '\0')
  })

  if (matchingOperations.length === 0) {
    throw new Error(`No adapter operation supports resource chain: ${params.resources.join(' -> ')}`)
  }

  const details = params.actions.map((action) => {
    const matchingActionOps = matchingOperations.filter(operation => operation.action === action)
    if (matchingActionOps.length === 0) {
      throw new Error(`Action ${action} is not valid for resource chain: ${params.resources.join(' -> ')}`)
    }

    const exact_command = matchingActionOps.every(operation => operation.exact_command === true)
    const risks = ['low', 'medium', 'high', 'critical'] as const
    const risk = matchingActionOps.reduce<typeof risks[number]>((current, operation) => {
      return risks.indexOf(operation.risk) > risks.indexOf(current) ? operation.risk : current
    }, 'low')

    const detail: OpenApeCliAuthorizationDetail = {
      type: 'openape_cli',
      cli_id: loaded.adapter.cli.id,
      operation_id: `capability.${action}`,
      resource_chain,
      action,
      permission: '',
      display: '',
      risk,
      ...(exact_command ? { constraints: { exact_command: true } } : {}),
    }
    detail.permission = canonicalizeCliPermission(detail)
    detail.display = summarizeDetail(detail)
    return detail
  })

  return {
    adapter: loaded.adapter,
    source: loaded.source,
    digest: loaded.digest,
    executable: loaded.adapter.cli.executable,
    details,
    executionContext: {
      adapter_id: loaded.adapter.cli.id,
      adapter_version: loaded.adapter.cli.version ?? loaded.adapter.schema,
      adapter_digest: loaded.digest,
      resolved_executable: loaded.adapter.cli.executable,
      context_bindings: Object.fromEntries(
        Array.from(selectorMap.entries()).flatMap(([resource, selector]) =>
          Object.entries(selector).map(([key, value]) => [`${resource}.${key}`, value] as const),
        ),
      ),
    },
    permissions: details.map(detail => detail.permission),
    summary: details.map(detail => detail.display).join('; '),
  }
}
