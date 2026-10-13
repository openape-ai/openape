import { unexpectedFields } from './fields'
import type { OpenApeCliAuthorizationDetail } from '@openape/core'
import { parseHttpPermission } from './http'
import { parseProgramArgv } from './programs'

/**
 * Grants decide what a Pod MAY do; the sandbox decides what it CAN reach. Both are independent and a call needs
 * both. Every grant is requested by the Pod identity at the IdP; Pods records it here with its coverage, so a
 * call is matched to any grant whose authorization details cover it.
 */
export type GrantState = 'pending' | 'approved' | 'denied' | 'revoked' | 'expired' | 'used'
export type GrantType = 'once' | 'timed' | 'always'
export const grantTypes: readonly GrantType[] = ['once', 'timed', 'always']
export interface PodGrant {
  id: string
  podId: string
  issuer: string
  subject: string
  cliId: string
  details: OpenApeCliAuthorizationDetail[]
  display: string
  grantType: GrantType
  state: GrantState
  approvedInSession: boolean
  createdAt: number
  updatedAt: number
}

/**
 * What to grant: whole programs or single commands of assigned applications, HTTPS origins with optional methods,
 * and with `runtime` the grant to run the Pod's stored script, which every run needs first.
 */
export interface GrantDeclaration {
  runtime?: boolean
  programs?: { application: string, argv?: string[] }[]
  http?: { origin: string, methods?: string[] }[]
}
export interface GrantTarget { podId: string }
export type GrantsCommand
  = | { type: 'list', podId?: string }
    | { type: 'request', target: GrantTarget, grants: GrantDeclaration, approve?: boolean }
    | { type: 'approve', podId: string, grantId: string, grantType?: Exclude<GrantType, 'timed'> }
    | { type: 'deny', podId: string, grantId: string }
    | { type: 'revoke', podId: string, grantId: string }

const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/
const grantId = /^[\w-]{1,128}$/
export const grantLimits = { programs: 16, http: 16, details: 64 } as const

function object(value: unknown, keys: string[], message: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(message)
  const unexpected = Object.keys(value).filter(key => !keys.includes(key))
  if (unexpected.length) throw new Error(unexpectedFields(message, unexpected))
  return value as Record<string, unknown>
}

export function parseGrantTarget(value: unknown): GrantTarget {
  const target = object(value, ['podId'], 'A grant target names one podId')
  if (typeof target.podId !== 'string' || !uuid.test(target.podId)) throw new Error('A grant target names one podId')
  return { podId: target.podId }
}

export function parseGrantDeclaration(value: unknown): GrantDeclaration {
  const declaration = object(value, ['runtime', 'programs', 'http'], 'Invalid grant declaration')
  const result: GrantDeclaration = {}
  if (declaration.runtime !== undefined && typeof declaration.runtime !== 'boolean') throw new Error('runtime must be a boolean')
  if (declaration.runtime) result.runtime = true
  if (declaration.programs !== undefined) {
    if (!Array.isArray(declaration.programs) || declaration.programs.length > grantLimits.programs) throw new Error(`Declare at most ${grantLimits.programs} program grants`)
    result.programs = declaration.programs.map((entry) => {
      const item = object(entry, ['application', 'argv'], 'Invalid program grant')
      if (typeof item.application !== 'string' || !item.application.trim() || item.application.length > 255) throw new Error('A program grant names an assigned application or its command name')
      return { application: item.application, ...(item.argv === undefined ? {} : { argv: parseProgramArgv(item.argv) }) }
    })
  }
  if (declaration.http !== undefined) {
    if (!Array.isArray(declaration.http) || declaration.http.length > grantLimits.http) throw new Error(`Declare at most ${grantLimits.http} HTTP grants`)
    result.http = declaration.http.map((entry) => {
      const item = object(entry, ['origin', 'methods'], 'Invalid HTTP grant')
      const permission = parseHttpPermission({ origin: item.origin, methods: item.methods ?? ['GET'] })
      return { origin: permission.origin, ...(item.methods === undefined ? {} : { methods: permission.methods }) }
    })
  }
  if (!result.runtime && !result.programs?.length && !result.http?.length) throw new Error('Declare the runtime or at least one program or HTTP grant')
  return result
}

export function parseGrantsCommand(value: unknown): GrantsCommand {
  const command = value as Record<string, unknown>
  const keys: Record<GrantsCommand['type'], string[]> = { list: ['podId'], request: ['target', 'grants', 'approve'], approve: ['podId', 'grantId', 'grantType'], deny: ['podId', 'grantId'], revoke: ['podId', 'grantId'] }
  if (!command || typeof command !== 'object' || Array.isArray(command) || typeof command.type !== 'string' || !Object.hasOwn(keys, command.type)) throw new Error('Unsupported grants command')
  const type = command.type as GrantsCommand['type']
  object(command, ['type', ...keys[type]], 'Invalid grants command fields')
  if (type === 'list') {
    if (command.podId !== undefined && (typeof command.podId !== 'string' || !uuid.test(command.podId))) throw new Error('Invalid grants filter')
    return { type, ...(command.podId ? { podId: command.podId as string } : {}) }
  }
  if (type === 'request') {
    if (command.approve !== undefined && typeof command.approve !== 'boolean') throw new Error('approve must be a boolean')
    return { type, target: parseGrantTarget(command.target), grants: parseGrantDeclaration(command.grants), ...(command.approve === undefined ? {} : { approve: command.approve }) }
  }
  if (typeof command.podId !== 'string' || !uuid.test(command.podId) || typeof command.grantId !== 'string' || !grantId.test(command.grantId)) throw new Error('A grant decision names its podId and grantId')
  if (type === 'approve') {
    // An explicit type is the owner's choice for this grant; without it the requested type is approved.
    if (command.grantType !== undefined && command.grantType !== 'once' && command.grantType !== 'always') throw new Error('grantType is once or always')
    return { type, podId: command.podId, grantId: command.grantId, ...(command.grantType ? { grantType: command.grantType as 'once' | 'always' } : {}) }
  }
  return { type, podId: command.podId, grantId: command.grantId }
}

export function parsePodGrant(value: unknown): PodGrant {
  const grant = object(value, ['id', 'podId', 'issuer', 'subject', 'cliId', 'details', 'display', 'grantType', 'state', 'approvedInSession', 'createdAt', 'updatedAt'], 'Invalid Pod grant') as unknown as PodGrant
  if (!grantId.test(grant.id) || !uuid.test(grant.podId) || typeof grant.issuer !== 'string' || typeof grant.subject !== 'string' || typeof grant.cliId !== 'string' || !Array.isArray(grant.details) || grant.details.length < 1 || grant.details.length > grantLimits.details || typeof grant.display !== 'string' || grant.display.length > 4096 || !grantTypes.includes(grant.grantType) || !['pending', 'approved', 'denied', 'revoked', 'expired', 'used'].includes(grant.state) || typeof grant.approvedInSession !== 'boolean' || !Number.isSafeInteger(grant.createdAt) || !Number.isSafeInteger(grant.updatedAt)) throw new Error('Invalid Pod grant')
  if (grant.details.some(detail => !detail || typeof detail !== 'object' || detail.type !== 'openape_cli' || detail.cli_id !== grant.cliId)) throw new Error('Pod grant details must belong to its program')
  return grant
}

export function parsePodGrants(value: unknown): PodGrant[] {
  if (!Array.isArray(value) || value.length > 1024) throw new Error('Invalid Pod grants')
  return value.map(parsePodGrant)
}

/** The read the approval UI and MCP show; the details stay with the grant. */
export function grantView(grant: PodGrant) {
  return { id: grant.id, podId: grant.podId, cliId: grant.cliId, display: grant.display, permissions: grant.details.map(detail => detail.permission), grantType: grant.grantType, state: grant.state, approvedInSession: grant.approvedInSession, updatedAt: grant.updatedAt }
}
