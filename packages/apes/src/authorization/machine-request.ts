import { basename, isAbsolute } from 'node:path'
import { parseProgramAuthorizeRequest } from '@openape/grants'
import type { OpenApeProgramExecutionRequest as MachineRequest } from '@openape/core'
import type { ProgramFile } from './program-files.js'

export type { OpenApeProgramExecutionRequest as MachineRequest } from '@openape/core'

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

export function parseMachineRequest(value: unknown): MachineRequest {
  const input = record(value, ['version', 'operationId', 'executable', 'argv', 'files', 'cwd', 'environment', 'targetHost', 'grantType', 'summary', 'batch', 'sandbox', 'forwardChannel', 'waitMs'])
  if (input.version !== 1 || typeof input.operationId !== 'string' || !/^[\w:-]{1,160}$/.test(input.operationId)) throw new Error('Invalid machine request version or operation identity')
  const executable = file(input.executable)
  if (input.grantType !== 'once' && input.grantType !== 'always') throw new Error('Machine grant type must be explicit')
  const authorization = parseProgramAuthorizeRequest({
    target_host: input.targetHost,
    audience: 'shapes',
    program: { name: basename(executable.path), sha256: executable.sha256 },
    argv: input.argv,
    ...(input.files === undefined ? {} : { files: input.files }),
    grant_type: input.grantType,
    ...(input.summary === undefined ? {} : { summary: input.summary }),
    ...(input.batch === undefined ? {} : { batch: input.batch }),
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
  if (!Number.isSafeInteger(input.waitMs) || Number(input.waitMs) < 0 || Number(input.waitMs) > 7 * 24 * 60 * 60 * 1000) throw new Error('Invalid machine approval deadline')
  return {
    version: 1,
    operationId: input.operationId,
    executable,
    argv: authorization.argv,
    files: authorization.files,
    cwd: path(input.cwd),
    environment,
    targetHost: authorization.target_host,
    grantType: authorization.grant_type ?? 'always',
    summary: authorization.summary,
    batch: authorization.batch,
    sandbox: file(input.sandbox),
    forwardChannel: input.forwardChannel,
    waitMs: Number(input.waitMs),
  }
}
