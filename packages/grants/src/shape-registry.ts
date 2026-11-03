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
   * `'builtin'` — an IdP-wide shape (imported from the shapes-registry).
   * `'custom'` — a personal shape of one human owner (`owner`) or a domain shape (`domain`).
   */
  source: 'builtin' | 'custom'
  /** The account a personal shape belongs to; absent for domain and IdP-wide shapes. */
  owner?: string
  /** The email domain a domain shape belongs to; absent for personal and IdP-wide shapes. */
  domain?: string
  /** The account that last wrote a domain shape. */
  published_by?: string
  /** The adapter TOML as written, kept so its writers can read it again. */
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
  /** Shapes root admins and operators of one email domain wrote for its users, sorted by `cli_id`. */
  listDomainShapes?: (domain: string) => Promise<ServerShape[]>
  /** Upserts a domain shape by (`domain`, `cli_id`). */
  saveDomainShape?: (domain: string, shape: ServerShape) => Promise<void>
  /** Removes a domain shape; false when the domain has none with this id. */
  deleteDomainShape?: (domain: string, cliId: string) => Promise<boolean>
}

/** Whose calls a shape view reads: the human owner (personal shapes) and their email domain (domain shapes). */
export interface ShapeScope {
  owner?: string
  domain?: string
}

/** The email domain of an account, lower-cased; undefined without one. */
export function emailDomain(email: string | undefined): string | undefined {
  const at = email?.lastIndexOf('@') ?? -1
  return email && at > 0 && at < email.length - 1 ? email.slice(at + 1).toLowerCase() : undefined
}

/** The scope of one human owner's calls (their own and their agents'); empty without an owner (brokered identities). */
export function shapeScopeOf(owner: string | undefined): ShapeScope {
  return owner ? { owner, domain: emailDomain(owner) } : {}
}

/** The shape facts a grant or call carries: which personal or domain shape version resolved it. */
export interface ShapeTierFacts {
  adapter_owner?: string
  adapter_domain?: string
  adapter_digest?: string
}

/**
 * Whether two grants or calls were resolved by the same shape tier. Personal
 * and domain shapes bind owner or domain and digest, so a republished,
 * removed or overriding shape never inherits an approval; IdP-wide shapes
 * bind no digest, so registry approvals carry over adapter updates.
 */
export function sameShapeTier(a: ShapeTierFacts | undefined, b: ShapeTierFacts | undefined): boolean {
  if (!a?.adapter_owner && !a?.adapter_domain && !b?.adapter_owner && !b?.adapter_domain) return true
  return a?.adapter_owner === b?.adapter_owner && a?.adapter_domain === b?.adapter_domain && a?.adapter_digest === b?.adapter_digest
}

function names(shapes: ServerShape[]): Set<string> {
  return new Set(shapes.flatMap(shape => [shape.cli_id, shape.executable]))
}

function notIn(taken: Set<string>) {
  return (shape: ServerShape) => !taken.has(shape.cli_id) && !taken.has(shape.executable)
}

/** Personal and domain shapes never count as tested versions or desktop operations; registry facts stay registry facts. */
function scoped(shape: ServerShape, tier: { owner: string } | { domain: string }): ServerShape {
  const { tested_digests: _tested, versions: _versions, virtual: _virtual, owner: _owner, domain: _domain, ...rest } = shape
  return { ...rest, source: 'custom', ...tier }
}

/**
 * The shapes the IdP reads calls of one scope with (issue 1553): the owner's
 * personal shapes first, then the domain's shapes whose `cli_id` and
 * executable no personal shape uses, then the IdP-wide shapes whose names
 * neither upper tier uses. An overridden shape drops out completely,
 * including its tested digests; only the Pods desktop's own (virtual) shapes
 * are never overridden. Without a scope (brokered identities, public
 * endpoints) it is the IdP-wide store.
 */
export function scopedShapeStore(store: ShapeStore, scope: ShapeScope): ShapeStore {
  const { owner, domain } = scope
  const { listOwnerShapes, listDomainShapes } = store
  const readPersonal = owner && listOwnerShapes ? () => listOwnerShapes(owner) : undefined
  const readDomain = domain && listDomainShapes ? () => listDomainShapes(domain) : undefined
  if (!readPersonal && !readDomain) return store
  // One read per view: a view lives for one decision, so it never serves a stale list across requests.
  let cached: Promise<ServerShape[]> | undefined
  const load = async (): Promise<ServerShape[]> => {
    const [registry, ownShapes, domainShapes] = await Promise.all([store.listShapes(), readPersonal?.() ?? [], readDomain?.() ?? []])
    // Operations the Pods desktop performs itself are never overridden, whatever a store holds.
    const desktop = notIn(names(registry.filter(shape => shape.virtual)))
    const personal = owner ? ownShapes.filter(desktop).map(shape => scoped(shape, { owner })) : []
    const domainTier = domain ? domainShapes.filter(desktop).filter(notIn(names(personal))).map(shape => scoped(shape, { domain })) : []
    return [...personal, ...domainTier, ...registry.filter(notIn(names([...personal, ...domainTier])))]
  }
  const combined = () => cached ??= load()
  const readOnly = async () => { throw new Error('scopedShapeStore is read-only') }
  return {
    listShapes: combined,
    async getShape(cliId) {
      return (await combined()).find(shape => shape.cli_id === cliId) ?? null
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
  const domains = new Map<string, Map<string, ServerShape>>()
  return {
    async listDomainShapes(domain) {
      return [...(domains.get(domain)?.values() ?? [])].sort((a, b) => a.cli_id.localeCompare(b.cli_id))
    },
    async saveDomainShape(domain, shape) {
      if (!domains.has(domain)) domains.set(domain, new Map())
      domains.get(domain)!.set(shape.cli_id, { ...shape, source: 'custom', domain })
    },
    async deleteDomainShape(domain, cliId) {
      return domains.get(domain)?.delete(cliId) ?? false
    },
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
