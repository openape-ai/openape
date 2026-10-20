import type { OpenApeGrantBatch, OpenApeGrantSummary } from './index.js'

export interface OpenApeExecutionFile { path: string, sha256: string }

/** Local trusted-controller transport for ape-shell -c; never an authorization assertion. */
export interface OpenApeProgramExecutionRequest {
  version: 1
  operationId: string
  executable: OpenApeExecutionFile
  argv: string[]
  files?: OpenApeExecutionFile[]
  cwd: string
  environment: Record<string, string>
  targetHost: string
  grantType: 'once' | 'always'
  summary?: OpenApeGrantSummary
  batch?: OpenApeGrantBatch
  reference?: string
  sandbox: OpenApeExecutionFile
  forwardChannel: boolean
  waitMs: number
}

/** Attested by the local owner controller over its private channel, never by the target script. */
export interface OpenApeOwnerScriptAuthority {
  source: 'owner-activation'
  activationId: string
  podId: string
  scriptHash: string
  assignmentRevision: number
  resourceEpoch: number
}

export interface OpenApeOwnerScriptExecutionRequest extends Omit<OpenApeProgramExecutionRequest, 'grantType' | 'waitMs' | 'summary' | 'batch' | 'reference'> {
  mode: 'owner-script'
  authority: OpenApeOwnerScriptAuthority
}

export type OpenApeMachineExecutionRequest = OpenApeProgramExecutionRequest | OpenApeOwnerScriptExecutionRequest
export type OpenApeExecutionAuthority = { source: 'grant', grantId: string } | OpenApeOwnerScriptAuthority
export type OpenApeExecutionFailure =
  | { kind: 'permission', state: 'missing' | 'pending' | 'denied' | 'revoked' | 'expired' | 'used', grantId?: string }
  | { kind: 'infrastructure', phase: 'authorization', retryAfterMs: number, status?: number, detail?: string }

export interface OpenApeExecutionAuthorizationReceipt {
  authority: OpenApeExecutionAuthority
  write: boolean
  grantId?: string
}
