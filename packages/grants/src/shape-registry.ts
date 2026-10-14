/**
 * Server-side shape registry: canonical adapter definitions stored and served
 * by the IdP. Replaces the client-side `~/.openape/shapes/adapters/*.toml`
 * lookup with an API-backed source of truth.
 *
 * A `ServerShape` describes one CLI (e.g. `git`) and its recognizable
 * operations (e.g. `git.clone`). Incoming agent requests are matched against
 * these shapes via `resolveServerShape()` (see server-resolver.ts).
 */

import type { ShapeCliVersions, ShapePresentation } from './shape-presentation.js'

/** One recognizable operation within a shape. */
export interface ServerShapeOperation {
  /**
   * Opaque operation id, e.g. `git.clone` or `_generic.exec` for the
   * synthetic fallback that matches any argv.
   */
  id: string

  /**
   * Prefix tokens that the argv (after the executable) must start with.
   * Empty array matches any argv (used by the generic operation only).
   */
  command: string[]

  /**
   * Named positional arguments. Entries prefixed with `=` are literal
   * matchers — the corresponding argv token must equal the suffix rather
   * than binding as a variable. Enables interleaved-literal command
   * shapes like `iurio project <id> workspace <id> task <id> archive`.
   */
  positionals?: string[]

  /** Flags (`--foo` or `-f`) that MUST be present for this operation to match. */
  required_options?: string[]

  /**
   * Options that take a value. When this or `flag_options` is present (even
   * empty), only declared options are accepted; any other option makes the
   * operation not match.
   */
  value_options?: string[]

  /** Options accepted as flags once options are declared. */
  flag_options?: string[]

  /**
   * Adapter-wide options accepted before the command prefix (`name` or
   * `name=binding`), copied from the adapter's `[cli] global_options`.
   */
  global_options?: string[]

  /** Template string like `Clone {repo}` rendered with resolved bindings. */
  display: string

  /** Abstract action label, e.g. `exec`, `read`, `write`, `delete`. */
  action: string

  /** Risk category for approver UX. */
  risk: 'low' | 'medium' | 'high' | 'critical'

  /**
   * Resource-chain template strings. Each string is of the form
   * `resource:key1={var1},key2={var2}`. Rendered with `parseResourceChain`
   * into `OpenApeCliResourceRef[]`.
   */
  resource_chain: string[]

  /**
   * When true, a grant based on this operation binds to the exact argv
   * hash — i.e. `apes run` enforces that the executed argv matches the
   * approved argv byte-for-byte. Default false.
   */
  exact_command?: boolean

  /** Approval card content from the adapter's `[operation.presentation]`. */
  presentation?: ShapePresentation
}

/** One CLI's complete shape definition. */
export interface ServerShape {
  /** Short identifier (typically matches the executable). */
  cli_id: string
  /** Executable name as invoked on the command line. */
  executable: string
  /** Human-readable description surfaced in UI. */
  description: string
  /** All recognizable operations, matched in declared order. */
  operations: ServerShapeOperation[]
  /**
   * `'builtin'` — seeded from the monorepo adapter directory.
   * `'custom'` — uploaded by a user via API (future feature).
   */
  source: 'builtin' | 'custom'
  /**
   * Semantic adapter digest (`semanticAdapterDigest()` in `@openape/shapes`):
   * covers only matching rules, so presentation and texts never change it.
   * Grants carry it in `execution_context.adapter_digest`.
   */
  digest: string
  /** CLI versions the adapter was checked against; absent for virtual executables. */
  versions?: ShapeCliVersions
  /**
   * File digests (`SHA-256:<hex>`) of executables the operations were checked
   * against (registry `[cli] tested_digests`). A program whose hash is listed
   * is a tested version of this shape.
   */
  tested_digests?: string[]
  /** Unix seconds. */
  createdAt: number
  /** Unix seconds. */
  updatedAt: number
}

/**
 * Persistence contract. Implemented by
 * `apps/openape-free-idp/server/utils/drizzle-shape-store.ts` for production
 * and `createInMemoryShapeStore()` below for tests.
 */
export interface ShapeStore {
  /** Returns all shapes sorted by `cli_id` ascending. */
  listShapes: () => Promise<ServerShape[]>
  /** Returns a single shape or null. */
  getShape: (cliId: string) => Promise<ServerShape | null>
  /** Upserts a shape by `cli_id`. */
  saveShape: (shape: ServerShape) => Promise<void>
  /** No-op if the cli_id does not exist. */
  deleteShape: (cliId: string) => Promise<void>
}

/**
 * In-memory `ShapeStore` — for unit tests and local fallbacks. Production
 * uses the Drizzle-backed store in openape-free-idp.
 */
export function createInMemoryShapeStore(seed: ServerShape[] = []): ShapeStore {
  const map = new Map<string, ServerShape>(seed.map(s => [s.cli_id, s]))
  return {
    async listShapes() {
      // eslint-disable-next-line e18e/prefer-array-to-sorted -- MapIterator has no toSorted()
      return [...map.values()].sort((a, b) => a.cli_id.localeCompare(b.cli_id))
    },
    async getShape(cliId) {
      return map.get(cliId) ?? null
    },
    async saveShape(shape) {
      map.set(shape.cli_id, shape)
    },
    async deleteShape(cliId) {
      map.delete(cliId)
    },
  }
}
