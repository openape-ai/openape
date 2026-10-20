import { basename, isAbsolute } from 'node:path'
import { parseProgramAuthorizeRequest } from '@openape/grants'
import type { OpenApeMachineExecutionRequest, OpenApeOwnerScriptAuthority, OpenApeOwnerScriptExecutionRequest, OpenApeProgramExecutionRequest } from '@openape/core'
import type { ProgramFile } from './program-files.js'

export type { OpenApeMachineExecutionRequest as MachineRequest } from '@openape/core'

function record(value: unknown, fields: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !fields.includes(key))) throw new Error('Invalid machine request fields')
  return value as Record<string, unknown>
}

function path(value: unknown): string {
  if (typeof value !== 'string' || !isAbsolute(value) || value.length > 4096 || /[\0\r\n]/.test(value)) throw new Error('Machine paths must be absolute and contain no control characters')
  return value
}

function file(value: unknown): ProgramFile {
  const item = record(value, ['path', 'sha256'])
  if (typeof item.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(item.sha256)) throw new Error('Missing machine file digest')
  return { path: path(item.path), sha256: item.sha256 }
}

function ownerAuthority(value: unknown): OpenApeOwnerScriptAuthority {
  const authority = record(value, ['source', 'activationId', 'podId', 'scriptHash', 'assignmentRevision', 'resourceEpoch'])
  if (authority.source !== 'owner-activation' || typeof authority.activationId !== 'string' || !authority.activationId || authority.activationId.length > 200 || /[^\w.:-]/u.test(authority.activationId)) throw new Error('Invalid owner script activation')
  if (typeof authority.podId !== 'string' || authority.podId.length !== 36 || !/^[a-f0-9-]{36}$/.test(authority.podId) || typeof authority.scriptHash !== 'string' || authority.scriptHash.length !== 64 || !/^[a-f0-9]{64}$/.test(authority.scriptHash)) throw new Error('Invalid owner script binding')
  if (!Number.isSafeInteger(authority.assignmentRevision) || Number(authority.assignmentRevision) < 1 || !Number.isSafeInteger(authority.resourceEpoch) || Number(authority.resourceEpoch) < 0) throw new Error('Invalid owner script revision')
  return { source: 'owner-activation', activationId: authority.activationId, podId: authority.podId, scriptHash: authority.scriptHash, assignmentRevision: Number(authority.assignmentRevision), resourceEpoch: Number(authority.resourceEpoch) }
}

export function parseMachineRequest(value: unknown): OpenApeProgramExecutionRequest
export function parseMachineRequest(value: unknown, mode: 'owner-script'): OpenApeOwnerScriptExecutionRequest
export function parseMachineRequest(value: unknown, mode: 'program' | 'owner-script'): OpenApeMachineExecutionRequest
export function parseMachineRequest(value: unknown, mode: 'program' | 'owner-script' = 'program'): OpenApeMachineExecutionRequest {
  const commonFields = ['version', 'operationId', 'executable', 'argv', 'files', 'cwd', 'environment', 'targetHost', 'sandbox', 'forwardChannel']
  const input = record(value, [...commonFields, ...mode === 'owner-script' ? ['mode', 'authority'] : ['grantType', 'summary', 'batch', 'reference', 'waitMs']])
  if (input.version !== 1 || typeof input.operationId !== 'string' || !/^[\w:-]{1,160}$/.test(input.operationId)) throw new Error('Invalid machine request version or operation identity')
  const executable = file(input.executable)
  if (mode === 'owner-script' ? input.mode !== 'owner-script' : input.grantType !== 'once' && input.grantType !== 'always') throw new Error('Machine execution mode must be explicit')
  const authorization = parseProgramAuthorizeRequest({
    target_host: input.targetHost,
    audience: 'shapes',
    program: { name: basename(executable.path), sha256: executable.sha256 },
    argv: input.argv,
    ...(input.files === undefined ? {} : { files: input.files }),
    grant_type: mode === 'owner-script' ? 'once' : input.grantType,
    ...(input.summary === undefined ? {} : { summary: input.summary }),
    ...(input.batch === undefined ? {} : { batch: input.batch }),
    ...(input.reference === undefined ? {} : { reference: input.reference }),
  })
  if (!input.environment || typeof input.environment !== 'object' || Array.isArray(input.environment)) throw new Error('Invalid machine environment')
  const environment: Record<string, string> = Object.create(null)
  const entries = Object.entries(input.environment)
  if (entries.length > 256) throw new Error('Machine environment is too large')
  for (const [key, value] of entries) {
    if (!/^[a-z_]\w*$/i.test(key) || typeof value !== 'string' || value.includes('\0') || value.length > 65536) throw new Error('Invalid machine environment entry')
    if (['APES_SHELL_WRAPPER', 'APES_SHELL_MODE', 'APES_SHELL_CHANNEL_FD'].includes(key)) throw new Error('Shell control variables cannot reach the target')
    environment[key] = value
  }
  if (typeof input.forwardChannel !== 'boolean') throw new Error('Machine channel forwarding must be explicit')
  const common = {
    version: 1,
    operationId: input.operationId,
    executable,
    argv: authorization.argv,
    files: authorization.files,
    cwd: path(input.cwd),
    environment,
    targetHost: authorization.target_host,
    sandbox: file(input.sandbox),
    forwardChannel: input.forwardChannel,
  }
  if (mode === 'owner-script') {
    const authority = ownerAuthority(input.authority)
    if (common.targetHost !== `pods:${authority.podId}` || !common.files?.some(item => item.sha256 === authority.scriptHash)) throw new Error('Owner activation does not match this script and Pod')
    return { ...common, version: 1, mode: 'owner-script', authority }
  }
  if (!Number.isSafeInteger(input.waitMs) || Number(input.waitMs) < 0 || Number(input.waitMs) > 7 * 24 * 60 * 60 * 1000) throw new Error('Invalid machine approval deadline')
  return {
    ...common,
    version: 1,
    grantType: authorization.grant_type ?? 'always',
    summary: authorization.summary,
    batch: authorization.batch,
    reference: authorization.reference,
    waitMs: Number(input.waitMs),
  }
}
