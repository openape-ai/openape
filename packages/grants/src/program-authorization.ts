import type { OpenApeCliAuthorizationDetail, OpenApeExecutionContext, OpenApeProgramAuthorizeRequest } from '@openape/core'
import { computeArgvHash } from './cli-permissions.js'
import { InvalidGrantBatchError, parseGrantBatch } from './grants.js'
import { InvalidGrantSummaryError, parseGrantSummary } from './grant-summary.js'
import { buildGenericResolvedServer, resolveServerShape } from './server-resolver.js'
import type { ServerShape, ShapeStore } from './shape-registry.js'

/** A program call that violates the authorize contract; callers answer it with 400. */
export class InvalidProgramAuthorizeRequestError extends Error {}

/**
 * Upper bounds of `POST /api/grants/authorize` (issue 1473). A maximal body
 * still fits the 128 KiB broker assertion that forwards it. A command token
 * repeats the argv several times, so it has its own bound (issue 1476): the
 * answer that carries it still fits the 128 KiB identity response the Pods
 * desktop reads and the 256 KiB a broker reads from the decision IdP.
 */
export const PROGRAM_AUTHORIZE_LIMITS = { bodyBytes: 64 * 1024, argvItems: 256, tokenChars: 120 * 1024 } as const

const FIELDS = ['target_host', 'audience', 'program', 'argv', 'grant_type', 'summary', 'batch']
const PROGRAM_FIELDS = ['name', 'sha256']
const SHA256_HEX = /^[0-9a-f]{64}$/

function fail(message: string): never {
  throw new InvalidProgramAuthorizeRequestError(message)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function unknownFields(value: Record<string, unknown>, allowed: string[], owner: string): void {
  const unknown = Object.keys(value).filter(key => !allowed.includes(key))
  if (unknown.length) fail(`${owner} has unknown fields: ${unknown.join(', ')}`)
}

function requiredText(value: unknown, field: string, maxLength = 2048): string {
  if (typeof value !== 'string' || !value || value.length > maxLength || value.includes('\0')) fail(`${field} must be a non-empty string without NUL of at most ${maxLength} characters`)
  return value
}

function programName(value: unknown): string {
  const name = requiredText(value, 'program.name', 255)
  if (name.includes('/') || name === '.' || name === '..') fail('program.name must be the basename of the executable')
  return name
}

function argvList(value: unknown): string[] {
  if (!Array.isArray(value)) fail('argv must be an array of strings')
  if (value.length > PROGRAM_AUTHORIZE_LIMITS.argvItems) fail(`argv must have at most ${PROGRAM_AUTHORIZE_LIMITS.argvItems} items`)
  if (value.some(item => typeof item !== 'string' || item.includes('\0'))) fail('argv items must be strings without NUL')
  return [...value] as string[]
}

function grantType(value: unknown): 'always' | 'once' {
  if (value === undefined) return 'always'
  if (value !== 'always' && value !== 'once') fail('grant_type must be always or once')
  return value
}

/**
 * Validates the body of `POST /api/grants/authorize` and of the `authorize`
 * broker operation. Unknown fields are refused, so a requester can never
 * send authorization details or an execution context for a program.
 */
export function parseProgramAuthorizeRequest(input: unknown): OpenApeProgramAuthorizeRequest {
  if (!isRecord(input)) fail('The request body must be a JSON object')
  unknownFields(input, FIELDS, 'The request')
  if (!isRecord(input.program)) fail('program must be an object with name and sha256')
  unknownFields(input.program, PROGRAM_FIELDS, 'program')
  if (typeof input.program.sha256 !== 'string' || !SHA256_HEX.test(input.program.sha256)) fail('program.sha256 must be 64 lowercase hex characters')
  const request: OpenApeProgramAuthorizeRequest = {
    target_host: requiredText(input.target_host, 'target_host'),
    audience: requiredText(input.audience, 'audience', 256),
    program: { name: programName(input.program.name), sha256: input.program.sha256 },
    argv: argvList(input.argv),
    grant_type: grantType(input.grant_type),
  }
  try {
    const summary = parseGrantSummary(input.summary)
    if (summary) request.summary = summary
    const batch = parseGrantBatch(input.batch)
    if (batch) request.batch = batch
  }
  catch (error) {
    if (error instanceof InvalidGrantSummaryError) fail(`Invalid summary: ${error.message}`)
    if (error instanceof InvalidGrantBatchError) fail(`Invalid batch: ${error.message}`)
    throw error
  }
  return request
}

/** The shape the IdP reads a program with, and whether the program file is one the shape was tested against. */
export interface ProgramShapeSelection {
  shape: ServerShape
  versionTested: boolean
}

/**
 * Owner decision 10 (issue 1473): first a shape whose tested digests contain
 * the program hash, else the shape for the executable name, which then reads
 * an untested version. Shapes are considered in `cli_id` order.
 */
/**
 * A shape for an operation the Pods desktop performs itself (pod-runtime,
 * pod-http, pod-ssh): marked virtual by the registry seed and checked against
 * no real program version. No program call may ever be read with it.
 */
export function isVirtualShape(shape: ServerShape): boolean {
  return shape.virtual === true && !shape.versions && !shape.tested_digests?.length
}

export async function selectProgramShape(store: ShapeStore, program: OpenApeProgramAuthorizeRequest['program']): Promise<ProgramShapeSelection | null> {
  const shapes = (await store.listShapes()).filter(shape => !isVirtualShape(shape))
  const digest = `SHA-256:${program.sha256}`
  const tested = shapes.find(shape => shape.tested_digests?.includes(digest))
  if (tested) return { shape: tested, versionTested: true }
  const named = shapes.find(shape => shape.executable === program.name)
  return named ? { shape: named, versionTested: false } : null
}

function hasWildcardSelector(detail: OpenApeCliAuthorizationDetail): boolean {
  return detail.resource_chain.some(resource => Object.values(resource.selector ?? {}).some(value => value.includes('*')))
}

/** One program call as the IdP resolved it. */
export interface ResolvedProgramCall {
  /** `[program.name, ...argv]`, the argv the requester executes. */
  executionArgv: string[]
  argvHash: string
  detail: OpenApeCliAuthorizationDetail
  /** Written by the IdP; the adapter fields are informational and never compared for coverage. */
  executionContext: OpenApeExecutionContext & { argv: string[], argv_hash: string, program_sha256: string, version_tested: boolean }
}

/**
 * Resolves a program call with the IdP's shapes. Without a shape, or when no
 * operation of the shape matches, the call becomes an exact-command detail
 * bound to its argv hash.
 */
export async function resolveProgramCall(store: ShapeStore, request: Pick<OpenApeProgramAuthorizeRequest, 'program' | 'argv'>): Promise<ResolvedProgramCall> {
  const executionArgv = [request.program.name, ...request.argv]
  const shapes = await store.listShapes()
  if (shapes.some(shape => isVirtualShape(shape) && (shape.executable === request.program.name || shape.cli_id === request.program.name)))
    throw new InvalidProgramAuthorizeRequestError(`program.name ${request.program.name} names an operation of the Pods desktop, not a program`)
  const selection = await selectProgramShape(store, request.program)
  const structured = selection ? await resolveServerShape(store, selection.shape.cli_id, executionArgv) : null
  // A `*` in a selector is a glob for coverage (selectorValueMatches): an argv value must never widen what it asks for.
  const resolved = structured && !hasWildcardSelector(structured.detail)
    ? structured
    : await buildGenericResolvedServer(selection?.shape.cli_id ?? request.program.name, executionArgv)
  const argvHash = await computeArgvHash(executionArgv)
  return {
    executionArgv,
    argvHash,
    detail: resolved.detail,
    executionContext: {
      ...resolved.executionContext,
      argv: executionArgv,
      argv_hash: argvHash,
      program_sha256: request.program.sha256,
      version_tested: selection?.versionTested ?? false,
    },
  }
}
