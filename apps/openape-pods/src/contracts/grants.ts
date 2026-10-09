import type { OpenApeCliAuthorizationDetail } from '@openape/core'
import { parseHttpPermission } from './http'
import { parseProgramArgv } from './programs'

/**
 * Grants decide what a Pod MAY do; the sandbox decides what it CAN reach. Both are independent and a call needs
 * both. Every grant is requested by the Pod identity at the IdP; Pods records it here with its coverage, so a
 * call is matched to any grant whose authorization details cover it.
 */
export type GrantState = 'pending' | 'approved' | 'denied' | 'revoked' | 'expired' | 'used'
export type GrantType = 'once' | 'always'
export interface GrantOrigin { networkId: string, revision: number }
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
  origin: GrantOrigin | null
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
export type GrantTarget = { podId: string } | { networkId: string, revision: number }
export type GrantsCommand
  = | { type: 'list', podId?: string, networkId?: string }
    | { type: 'request', target: GrantTarget, grants: GrantDeclaration, approve?: boolean }
    | { type: 'approve', podId: string, grantId: string, grantType?: GrantType }
    | { type: 'deny', podId: string, grantId: string }
    | { type: 'revoke', podId: string, grantId: string }

const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/
const grantId = /^[\w-]{1,128}$/
export const grantLimits = { programs: 16, http: 16, details: 64 } as const

function object(value: unknown, keys: string[], message: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !keys.includes(key))) throw new Error(message)
  return value as Record<string, unknown>
}

export function parseGrantTarget(value: unknown): GrantTarget {
  const target = object(value, ['podId', 'networkId', 'revision'], 'Invalid grant target')
  if (typeof target.podId === 'string' && uuid.test(target.podId) && target.networkId === undefined && target.revision === undefined) return { podId: target.podId }
  if (typeof target.networkId === 'string' && uuid.test(target.networkId) && target.podId === undefined && Number.isSafeInteger(target.revision) && Number(target.revision) >= 1) return { networkId: target.networkId, revision: Number(target.revision) }
  throw new Error('A grant target is either {podId} or {networkId, revision}')
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
  const keys: Record<GrantsCommand['type'], string[]> = { list: ['podId', 'networkId'], request: ['target', 'grants', 'approve'], approve: ['podId', 'grantId', 'grantType'], deny: ['podId', 'grantId'], revoke: ['podId', 'grantId'] }
  if (!command || typeof command !== 'object' || Array.isArray(command) || typeof command.type !== 'string' || !Object.hasOwn(keys, command.type)) throw new Error('Unsupported grants command')
  const type = command.type as GrantsCommand['type']
  object(command, ['type', ...keys[type]], 'Invalid grants command fields')
  if (type === 'list') {
    for (const key of ['podId', 'networkId'] as const) {
      if (command[key] !== undefined && (typeof command[key] !== 'string' || !uuid.test(command[key]))) throw new Error('Invalid grants filter')
    }
    return { type, ...(command.podId ? { podId: command.podId as string } : {}), ...(command.networkId ? { networkId: command.networkId as string } : {}) }
  }
  if (type === 'request') {
    if (command.approve !== undefined && typeof command.approve !== 'boolean') throw new Error('approve must be a boolean')
    return { type, target: parseGrantTarget(command.target), grants: parseGrantDeclaration(command.grants), ...(command.approve === undefined ? {} : { approve: command.approve }) }
  }
  if (typeof command.podId !== 'string' || !uuid.test(command.podId) || typeof command.grantId !== 'string' || !grantId.test(command.grantId)) throw new Error('A grant decision names its podId and grantId')
  if (type === 'approve') {
    if (command.grantType !== undefined && command.grantType !== 'once' && command.grantType !== 'always') throw new Error('grantType is once or always')
    return { type, podId: command.podId, grantId: command.grantId, ...(command.grantType ? { grantType: command.grantType as GrantType } : {}) }
  }
  return { type, podId: command.podId, grantId: command.grantId }
}

export function parsePodGrant(value: unknown): PodGrant {
  const grant = object(value, ['id', 'podId', 'issuer', 'subject', 'cliId', 'details', 'display', 'grantType', 'state', 'origin', 'approvedInSession', 'createdAt', 'updatedAt'], 'Invalid Pod grant') as unknown as PodGrant
  if (!grantId.test(grant.id) || !uuid.test(grant.podId) || typeof grant.issuer !== 'string' || typeof grant.subject !== 'string' || typeof grant.cliId !== 'string' || !Array.isArray(grant.details) || grant.details.length < 1 || grant.details.length > grantLimits.details || typeof grant.display !== 'string' || grant.display.length > 4096 || !['once', 'always'].includes(grant.grantType) || !['pending', 'approved', 'denied', 'revoked', 'expired', 'used'].includes(grant.state) || typeof grant.approvedInSession !== 'boolean' || !Number.isSafeInteger(grant.createdAt) || !Number.isSafeInteger(grant.updatedAt)) throw new Error('Invalid Pod grant')
  if (grant.details.some(detail => !detail || typeof detail !== 'object' || detail.type !== 'openape_cli' || detail.cli_id !== grant.cliId)) throw new Error('Pod grant details must belong to its program')
  if (grant.origin !== null && (!grant.origin || typeof grant.origin.networkId !== 'string' || !uuid.test(grant.origin.networkId) || !Number.isSafeInteger(grant.origin.revision) || grant.origin.revision < 1)) throw new Error('Invalid Pod grant origin')
  return grant
}

export function parsePodGrants(value: unknown): PodGrant[] {
  if (!Array.isArray(value) || value.length > 1024) throw new Error('Invalid Pod grants')
  return value.map(parsePodGrant)
}

/** The read the approval UI and MCP show; the details stay with the grant. */
export function grantView(grant: PodGrant) {
  return { id: grant.id, podId: grant.podId, cliId: grant.cliId, display: grant.display, permissions: grant.details.map(detail => detail.permission), grantType: grant.grantType, state: grant.state, origin: grant.origin, approvedInSession: grant.approvedInSession, updatedAt: grant.updatedAt }
}
