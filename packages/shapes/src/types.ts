import type { OpenApeCliAuthorizationDetail, OpenApeExecutionContext, OpenApeGrantRequest, ScopeRiskLevel } from '@openape/core'
import type { ShapeCliVersions, ShapePresentation } from '@openape/grants'

export interface ShapesAdapter {
  schema: string
  /** Version fields are set together (see `ShapeCliVersions`) or not at all. */
  cli: {
    id: string
    executable: string
    audience?: string
    version?: string
    /**
     * File digests (`SHA-256:<hex>`) of executables the operations were checked against. For tools without a
     * version command, such as single-file scripts, a matching digest is the tested version.
     */
    tested_digests?: string[]
  } & Partial<ShapeCliVersions>
  operations: ShapesOperation[]
}

export interface ShapesOperation {
  id: string
  command: string[]
  /**
   * Positional argument names. Entries prefixed with `=` are literal matchers:
   * the corresponding argv token must equal the suffix (not bound as a variable).
   * Enables interleaved-literal command shapes like
   * `iurio project <id> workspace <id> task <id> archive`.
   */
  positionals?: string[]
  required_options?: string[]
  /**
   * Options that take a value. When this or `flag_options` is present (even
   * empty), only declared options are accepted: these and `required_options`
   * consume the following argv token, `flag_options` are flags, and any other
   * option makes the operation not match. Without both the legacy rule
   * applies (`--name value` binds).
   */
  value_options?: string[]
  /** Options accepted as flags once options are declared (see `value_options`). */
  flag_options?: string[]
  /**
   * Copied from `[cli] global_options`: options such as git `-C <path>`
   * accepted before the command prefix, as `name` or `name=binding`.
   */
  global_options?: string[]
  display: string
  action: string
  risk: ScopeRiskLevel
  resource_chain: string[]
  exact_command?: boolean
  /** Approval card content from `[operation.presentation]`. */
  presentation?: ShapePresentation
}

export interface LoadedAdapter {
  adapter: ShapesAdapter
  source: string
  /**
   * Semantic digest (`semanticAdapterDigest`) that grants bind in
   * `execution_context.adapter_digest`; presentation and texts do not change it.
   */
  digest: string
  /** `SHA-256:` digest of the file bytes, for file integrity checks; set by `loadAdapter`. */
  fileDigest?: string
  /**
   * True when this adapter was synthesized in-memory for a CLI that has no
   * registered shape. Synthetic adapters bypass `resolveCommand()` and are
   * fed into the grant pipeline via `buildGenericResolved()` directly.
   * See `shapes/generic.ts`.
   */
  synthetic?: boolean
}

export interface ResolvedCommand {
  adapter: ShapesAdapter
  source: string
  digest: string
  executable: string
  commandArgv: string[]
  bindings: Record<string, string>
  detail: OpenApeCliAuthorizationDetail
  executionContext: OpenApeExecutionContext
  permission: string
}

export interface ResolvedCapability {
  adapter: ShapesAdapter
  source: string
  digest: string
  executable: string
  details: OpenApeCliAuthorizationDetail[]
  executionContext: OpenApeExecutionContext
  permissions: string[]
  summary: string
}

export interface GrantRequestOptions {
  requester: string
  target_host: string
  grant_type: 'once' | 'timed' | 'always'
  reason?: string
  run_as?: string
}

export interface BuiltGrantRequest {
  request: OpenApeGrantRequest
}

// ── Registry Types ──────────────────────────────────

export interface RegistryEntry {
  id: string
  name: string
  description: string
  category: string
  tags: string[]
  author: string
  executable: string
  min_shapes_version: string
  /** `SHA-256:` digest of the adapter file bytes. */
  digest: string
  /** Semantic digest grants bind (`semanticAdapterDigest`); registry indexes since issue 1473 record it. */
  grant_digest?: string
  download_url: string
}

export interface RegistryIndex {
  version: number
  generated_at: string
  adapters: RegistryEntry[]
}

export interface AdapterMeta {
  id: string
  name: string
  description: string
  author: string
  category: string
  tags: string[]
  executable: string
  risk_summary?: string
  homepage?: string
  min_shapes_version: string
}
