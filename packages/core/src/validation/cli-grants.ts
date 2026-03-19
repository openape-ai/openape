import type {
  OpenApeCliAuthorizationDetail,
  OpenApeCliResourceRef,
} from '../types/index.js'

export interface CliAuthorizationDetailValidationResult {
  valid: boolean
  errors: string[]
}

function normalizeSelector(selector?: Record<string, string>): Record<string, string> | undefined {
  if (!selector)
    return undefined

  const entries = Object.entries(selector)
    .filter(([, value]) => value !== undefined && value !== '')
    .sort(([a], [b]) => a.localeCompare(b))

  if (entries.length === 0)
    return undefined

  return Object.fromEntries(entries)
}

function selectorString(selector?: Record<string, string>): string {
  const normalized = normalizeSelector(selector)
  if (!normalized)
    return '*'

  return Object.entries(normalized)
    .map(([key, value]) => `${key}=${value}`)
    .join(',')
}

export function canonicalizeCliPermission(detail: Pick<OpenApeCliAuthorizationDetail, 'cli_id' | 'resource_chain' | 'action'>): string {
  const chain = detail.resource_chain
    .map(resource => `${resource.resource}[${selectorString(resource.selector)}]`)
    .join('.')

  return `${detail.cli_id}.${chain}#${detail.action}`
}

export function validateCliAuthorizationDetail(detail: unknown): CliAuthorizationDetailValidationResult {
  const errors: string[] = []

  if (!detail || typeof detail !== 'object') {
    return { valid: false, errors: ['detail must be an object'] }
  }

  const candidate = detail as Record<string, unknown>
  if (candidate.type !== 'openape_cli')
    errors.push('type must be "openape_cli"')
  if (typeof candidate.cli_id !== 'string' || !candidate.cli_id)
    errors.push('cli_id is required')
  if (typeof candidate.operation_id !== 'string' || !candidate.operation_id)
    errors.push('operation_id is required')
  if (typeof candidate.action !== 'string' || !candidate.action)
    errors.push('action is required')
  if (typeof candidate.permission !== 'string' || !candidate.permission)
    errors.push('permission is required')
  if (typeof candidate.display !== 'string' || !candidate.display)
    errors.push('display is required')
  if (!['low', 'medium', 'high', 'critical'].includes(String(candidate.risk ?? '')))
    errors.push('risk must be one of: low, medium, high, critical')

  if (!Array.isArray(candidate.resource_chain) || candidate.resource_chain.length === 0) {
    errors.push('resource_chain must be a non-empty array')
  }
  else {
    candidate.resource_chain.forEach((resource, index) => {
      if (!resource || typeof resource !== 'object') {
        errors.push(`resource_chain[${index}] must be an object`)
        return
      }

      const record = resource as Record<string, unknown>
      if (typeof record.resource !== 'string' || !record.resource) {
        errors.push(`resource_chain[${index}].resource is required`)
      }
      if (record.selector !== undefined) {
        if (typeof record.selector !== 'object' || record.selector === null || Array.isArray(record.selector)) {
          errors.push(`resource_chain[${index}].selector must be an object`)
        }
        else {
          for (const [key, value] of Object.entries(record.selector as Record<string, unknown>)) {
            if (!key || typeof value !== 'string' || !value) {
              errors.push(`resource_chain[${index}].selector entries must be non-empty strings`)
              break
            }
          }
        }
      }
    })
  }

  if (errors.length > 0)
    return { valid: false, errors }

  const typed = detail as OpenApeCliAuthorizationDetail
  const canonical = canonicalizeCliPermission(typed)
  if (typed.permission !== canonical) {
    return {
      valid: false,
      errors: [`permission does not match canonical form: expected ${canonical}`],
    }
  }

  return { valid: true, errors: [] }
}

function resourceRefCovers(granted: OpenApeCliResourceRef, required: OpenApeCliResourceRef): boolean {
  if (granted.resource !== required.resource)
    return false

  const grantedSelector = normalizeSelector(granted.selector)
  const requiredSelector = normalizeSelector(required.selector)

  if (!grantedSelector)
    return true
  if (!requiredSelector)
    return false

  return Object.entries(grantedSelector).every(([key, value]) => requiredSelector[key] === value)
}

export function isCliAuthorizationDetailExact(detail: Pick<OpenApeCliAuthorizationDetail, 'constraints'>): boolean {
  return detail.constraints?.exact_command === true
}

export function cliAuthorizationDetailCovers(
  granted: OpenApeCliAuthorizationDetail,
  required: OpenApeCliAuthorizationDetail,
): boolean {
  if (granted.type !== 'openape_cli' || required.type !== 'openape_cli')
    return false
  if (granted.cli_id !== required.cli_id)
    return false
  if (granted.action !== required.action)
    return false
  if (granted.resource_chain.length !== required.resource_chain.length)
    return false

  return granted.resource_chain.every((resource, index) => resourceRefCovers(resource, required.resource_chain[index]!))
}

export function cliAuthorizationDetailsCover(
  grantedDetails: OpenApeCliAuthorizationDetail[],
  requiredDetails: OpenApeCliAuthorizationDetail[],
): boolean {
  return requiredDetails.every(required =>
    grantedDetails.some(granted => cliAuthorizationDetailCovers(granted, required)),
  )
}

export async function computeArgvHash(argv: string[]): Promise<string> {
  const encoder = new TextEncoder()
  const data = encoder.encode(JSON.stringify(argv))
  const hashBuffer = await crypto.subtle.digest('SHA-256', data)
  const hashArray = new Uint8Array(hashBuffer)
  const digest = Array.from(hashArray).map(b => b.toString(16).padStart(2, '0')).join('')
  return `SHA-256:${digest}`
}
