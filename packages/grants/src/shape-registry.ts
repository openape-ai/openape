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
  /** Registry policy: one exact human decision, or an operation that must never execute. */
  decision?: 'once' | 'deny'

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
   * `'builtin'` — seeded from the shapes-registry.
   * `'custom'` — published by one human owner for their own agents (`owner`).
   */
  source: 'builtin' | 'custom'
  /** The account that published a custom shape; absent for registry shapes. */
  owner?: string
  /** The adapter TOML an owner published, kept so the owner can read it again; absent for registry shapes. */
  toml?: string
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
  /**
   * True for an executable no program provides: the Pods desktop performs the
   * operation itself (pod-runtime, pod-http, pod-ssh). Set by the registry seed.
   */
  virtual?: boolean
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
  /**
   * Shapes one human owner published for their own agents, sorted by `cli_id`.
   * They live apart from the registry shapes above, which `listShapes` and
   * `getShape` alone return; `ownerScopedShapeStore` joins both for one owner.
   */
  listOwnerShapes?: (owner: string) => Promise<ServerShape[]>
  /** Upserts an owner shape by (`owner`, `cli_id`). */
  saveOwnerShape?: (owner: string, shape: ServerShape) => Promise<void>
  /** Removes an owner shape; false when the owner has none with this id. */
  deleteOwnerShape?: (owner: string, cliId: string) => Promise<boolean>
}

/**
 * The shapes the IdP reads one owner's program calls with: every registry
 * shape first, then the owner's own shapes whose `cli_id` and executable no
 * registry shape uses. Owner shapes never count as tested versions, so a
 * program hash can never move a call from a registry shape to an owner shape.
 * Without an owner (brokered identities, public endpoints) it is the registry.
 */
export function ownerScopedShapeStore(store: ShapeStore, owner: string | undefined): ShapeStore {
  if (!owner || !store.listOwnerShapes) return store
  const listOwnerShapes = store.listOwnerShapes
  // One read per view: a view lives for one decision, so it never serves a stale list across requests.
  let cached: Promise<{ registry: ServerShape[], own: ServerShape[] }> | undefined
  const combined = () => cached ??= load()
  const load = async (): Promise<{ registry: ServerShape[], own: ServerShape[] }> => {
    const registry = await store.listShapes()
    const taken = new Set(registry.flatMap(shape => [shape.cli_id, shape.executable]))
    const own = (await listOwnerShapes(owner))
      .filter(shape => !taken.has(shape.cli_id) && !taken.has(shape.executable))
      .map(({ tested_digests: _tested, versions: _versions, virtual: _virtual, ...shape }) => ({ ...shape, source: 'custom' as const, owner }))
    return { registry, own }
  }
  const readOnly = async () => { throw new Error('ownerScopedShapeStore is read-only') }
  return {
    async listShapes() {
      const { registry, own } = await combined()
      return [...registry, ...own]
    },
    async getShape(cliId) {
      const { registry, own } = await combined()
      return registry.find(shape => shape.cli_id === cliId) ?? own.find(shape => shape.cli_id === cliId) ?? null
    },
    saveShape: readOnly,
    deleteShape: readOnly,
  }
}

/**
 * In-memory `ShapeStore` — for unit tests and local fallbacks. Production
 * uses the Drizzle-backed store in openape-free-idp.
 */
export function createInMemoryShapeStore(seed: ServerShape[] = []): ShapeStore {
  const map = new Map<string, ServerShape>(seed.map(s => [s.cli_id, s]))
  const owned = new Map<string, Map<string, ServerShape>>()
  return {
    async listOwnerShapes(owner) {
      return [...(owned.get(owner)?.values() ?? [])].sort((a, b) => a.cli_id.localeCompare(b.cli_id))
    },
    async saveOwnerShape(owner, shape) {
      if (!owned.has(owner)) owned.set(owner, new Map())
      owned.get(owner)!.set(shape.cli_id, { ...shape, source: 'custom', owner })
    },
    async deleteOwnerShape(owner, cliId) {
      return owned.get(owner)?.delete(cliId) ?? false
    },
    async listShapes() {

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
