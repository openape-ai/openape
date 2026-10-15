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
  sandbox: OpenApeExecutionFile
  forwardChannel: boolean
  waitMs: number
}
