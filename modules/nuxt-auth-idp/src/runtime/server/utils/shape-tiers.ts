import type { OpenApeGrant } from '@openape/core'
import type { ServerShape, ShapeChange, ShapeStore, ShapeTier } from '@openape/grants'
import { assertResourceChainTemplates, buildCliAuthDetail, DESKTOP_OWN_SHAPE_IDS, emailDomain, scopedShapeStore } from '@openape/grants'
import { parseAdapterToml, semanticAdapterDigest } from '@openape/shapes'
import { useGrantStores } from './grant-stores'
import { shapeOwnerOf } from './owner-shape-current'
import { createProblemError } from './problem'
import { useShapeStore } from './shape-store'
import type { ShapeWriter } from './shape-writer'
import { useIdpStores } from './stores'

/**
 * Shape tiers (issues 1551, 1553): IdP-wide shapes written with the
 * management token, domain shapes written by a domain's root admins and
 * operators, personal shapes written by one human owner. Every write of
 * every tier goes through `importShapes`: one parser, one preview, one
 * all-or-nothing write and one audit.
 */
export const SHAPE_LIMITS = { tomlBytes: 64 * 1024, perScope: { instance: 500, domain: 100, personal: 50 } } as const

const DESKTOP_OWN = new Set(DESKTOP_OWN_SHAPE_IDS)
const CLI_NAME = /^[a-z0-9][\w.-]{0,63}$/i

/** A continuing grant one shape write affects. */
export interface AffectedGrant {
  id: string
  requester: string
  cli_id: string
  operation_id: string
  grant_type: string
  decided_at: number | null
}

/** A continuing grant whose reuse depends on a personal or domain shape. */
export interface OwnerShapeGrant extends AffectedGrant {
  /** False when the grant was approved for another version (digest) of the shape. */
  digest_current: boolean
}

export interface OwnerShapeView {
  cli_id: string
  executable: string
  digest: string
  toml: string | null
  description: string
  operations: ServerShape['operations']
  created_at: number
  published_at: number
  /** The root admin or operator who last wrote a domain shape; null for other tiers. */
  published_by: string | null
  bound_grants: OwnerShapeGrant[]
}

/** A lower-tier shape a write newly hides for the writer's scope, and the grants resolved with it there. */
export interface OverriddenShape {
  cli_id: string
  tier: 'domain' | 'instance'
  by: string
  grants: AffectedGrant[]
}

export interface ShapeImportReport {
  scope: ShapeTier
  /** The domain or owner the write applies to; null for IdP-wide shapes. */
  scope_key: string | null
  dry_run: boolean
  /** True when the IdP stored the changes; false for a dry run or an unchanged repeat. */
  saved: boolean
  added: string[]
  /** Matching rules changed (another semantic digest). */
  rules_changed: string[]
  /** Only texts, presentation or registry facts changed; grants are unaffected. */
  text_changed: string[]
  removed: string[]
  unchanged: string[]
  /** Continuing grants of this tier that stop being reused. */
  grants_losing_reuse: AffectedGrant[]
  /** IdP-wide continuing grants that keep working under changed rules (registry approvals carry over updates). */
  grants_keeping_reuse: AffectedGrant[]
  overrides: OverriddenShape[]
}

function fail(title: string, status = 400): never {
  throw createProblemError({ status, title })
}

function tierStore(): ShapeStore & Required<Pick<ShapeStore, 'applyShapeChanges'>> {
  const store = useShapeStore()
  if (!store.applyShapeChanges) fail('This identity provider does not store shape changes', 501)
  return store as ReturnType<typeof tierStore>
}

/** One tier's own shapes, without any other tier. */
async function listTier(store: ShapeStore, writer: Pick<ShapeWriter, 'scope' | 'key'>): Promise<ServerShape[]> {
  if (writer.scope === 'instance') return await store.listShapes()
  const list = writer.scope === 'domain' ? store.listDomainShapes : store.listOwnerShapes
  if (!list) fail(`This identity provider does not store ${writer.scope} shapes`, 501)
  return await list(writer.key)
}

/**
 * Parses an adapter with the same strict parser and semantic digest as the
 * registry, apes and the Pods desktop. Refused for every tier: invalid
 * names, `_` operation ids (the generic fallback) and duplicate operation
 * ids. Only IdP-wide shapes may carry registry version facts and the Pods
 * desktop's own names (marked virtual); personal and domain resource chains
 * must render with the bindings every match sets.
 */
export function parseTierShape(scope: ShapeTier, toml: unknown, description: unknown = ''): ServerShape {
  if (typeof toml !== 'string' || !toml.trim()) fail('Each shape must be {"toml": "<adapter.toml content>"}')
  if (Buffer.byteLength(toml) > SHAPE_LIMITS.tomlBytes) fail(`An adapter exceeds ${SHAPE_LIMITS.tomlBytes} bytes`, 413)
  if (typeof description !== 'string' || description.length > 2000) fail('description must be a string of at most 2000 characters')
  let adapter: ReturnType<typeof parseAdapterToml>
  try { adapter = parseAdapterToml(toml) }
  catch (error) { fail(`Invalid adapter: ${error instanceof Error ? error.message : String(error)}`) }
  const { id, executable, tested_digests, tested_versions, version_command, version_pattern } = adapter.cli
  for (const name of [id, executable]) {
    if (!CLI_NAME.test(name) || name.includes('/')) fail(`${JSON.stringify(name)} must be a plain program name`)
    if (scope !== 'instance' && DESKTOP_OWN.has(name)) fail(`${name} is reserved for the Pods desktop`, 409)
  }
  if (scope !== 'instance' && (tested_digests || tested_versions || version_command || version_pattern))
    fail(`${id}: tested_digests and tested versions are registry facts; remove them from a ${scope} shape`)
  if (!adapter.operations.length) fail(`${id}: the adapter declares no operation`)
  const ids = new Set<string>()
  for (const operation of adapter.operations) {
    if (operation.id.startsWith('_')) fail(`${id}: operation id ${operation.id} is reserved`)
    // The resolver reads an operation's policy by id: a duplicate would let a later `deny` or `once` be read from an earlier one.
    if (ids.has(operation.id)) fail(`${id}: operation id ${operation.id} is declared twice`)
    ids.add(operation.id)
    // The registry checks its own adapters; it already ships templates binding global options.
    if (scope === 'instance') continue
    try {
      assertResourceChainTemplates(operation.resource_chain)
      const always = [...(operation.positionals ?? []).filter(name => !name.startsWith('=')), ...(operation.required_options ?? [])]
      buildCliAuthDetail(id, operation, Object.fromEntries(always.map(name => [name, 'owner/name'])))
    }
    catch (error) { fail(`${id}: operation ${operation.id}: ${error instanceof Error ? error.message : String(error)} (templates may use positionals and required options)`) }
  }
  return {
    cli_id: id,
    executable,
    description: scope === 'personal' ? '' : description,
    operations: adapter.operations,
    source: scope === 'instance' ? 'builtin' : 'custom',
    digest: semanticAdapterDigest(adapter),
    toml,
    ...(scope === 'instance' && tested_versions && version_command && version_pattern ? { versions: { tested_versions, version_command, version_pattern } } : {}),
    ...(scope === 'instance' && tested_digests ? { tested_digests } : {}),
    ...(scope === 'instance' && DESKTOP_OWN.has(id) ? { virtual: true } : {}),
    createdAt: 0,
    updatedAt: 0,
  }
}

/** What an import compares to decide whether a shape changed; IdP-wide rows store no TOML. */
function content(shape: ServerShape, scope: ShapeTier): string {
  const { cli_id, executable, description, operations, versions, tested_digests, virtual, toml } = shape
  return JSON.stringify(scope === 'instance' ? { cli_id, executable, description, operations, versions, tested_digests, virtual: virtual === true } : { cli_id, executable, description, toml })
}

function names(shape: Pick<ServerShape, 'cli_id' | 'executable'>): string[] {
  return [shape.cli_id, shape.executable]
}

function shares(a: ServerShape, b: ServerShape): boolean {
  return names(a).some(name => names(b).includes(name))
}

interface ImportBody {
  shapes: { toml: unknown, description?: unknown }[]
  prune: boolean
  source: ShapeChange['source']
}

function readImportBody(body: unknown): ImportBody {
  const value = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>
  const unknownKeys = Object.keys(value).filter(key => !['shapes', 'prune', 'source'].includes(key))
  if (unknownKeys.length) fail(`Unknown field ${unknownKeys[0]}`)
  if (!Array.isArray(value.shapes) || !value.shapes.length) fail('Body must be {"shapes": [{"toml": "<adapter.toml>"}], "prune"?: boolean, "source"?: {...}}')
  if (value.prune !== undefined && typeof value.prune !== 'boolean') fail('prune must be a boolean')
  const source = value.source
  if (source !== undefined && (!source || typeof source !== 'object' || Array.isArray(source))) fail('source must be an object')
  const { repo, commit, dirty, ...rest } = (source ?? {}) as Record<string, unknown>
  if (Object.keys(rest).length || (repo !== undefined && (typeof repo !== 'string' || repo.length > 500)) || (commit !== undefined && (typeof commit !== 'string' || !/^[0-9a-f]{7,64}$/.test(commit))) || (dirty !== undefined && typeof dirty !== 'boolean'))
    fail('source may only name repo (string), commit (hex) and dirty (boolean)')
  const shapes = value.shapes.map((item) => {
    if (!item || typeof item !== 'object') fail('Each shape must be {"toml": "<adapter.toml content>"}')
    return item as ImportBody['shapes'][number]
  })
  return { shapes, prune: value.prune === true, source: source === undefined ? null : { ...(repo ? { repo: repo as string } : {}), ...(commit ? { commit: commit as string } : {}), ...(dirty !== undefined ? { dirty: dirty as boolean } : {}) } }
}

function detailOf(grant: OpenApeGrant) {
  const detail = grant.request.authorization_details?.find(item => item.type === 'openape_cli')
  return detail?.type === 'openape_cli' ? detail : undefined
}

function continuing(grant: OpenApeGrant, now: number): boolean {
  return grant.status === 'approved' && (!grant.expires_at || grant.expires_at > now) && (grant.request.grant_type ?? 'once') !== 'once' && (grant.type ?? 'command') === 'command' && !!detailOf(grant)
}

function affected(grant: OpenApeGrant): AffectedGrant {
  const detail = detailOf(grant)
  return { id: grant.id, requester: grant.request.requester, cli_id: detail?.cli_id ?? '', operation_id: detail?.operation_id ?? '', grant_type: grant.request.grant_type ?? 'once', decided_at: grant.decided_at ?? null }
}

/** The tier a grant was resolved with, as `scope:key`. */
function grantTier(grant: OpenApeGrant): string {
  const context = grant.request.execution_context
  return context?.adapter_owner ? `personal:${context.adapter_owner}` : context?.adapter_domain ? `domain:${context.adapter_domain}` : 'instance:'
}

/** The owner and every agent of the owner: the requesters whose calls read the owner's personal shapes. */
async function ownerRequesters(owner: string): Promise<string[]> {
  return [owner, ...(await useIdpStores().userStore.findByOwner(owner)).map(user => user.email)]
}

/**
 * The continuing grants a write of this tier can affect, with the scope key
 * of the requester's calls: a personal tier reads the owner's and their
 * agents' grants; domain and IdP-wide writes page through every approved grant.
 */
async function scopeGrants(writer: Pick<ShapeWriter, 'scope' | 'key'>): Promise<{ grant: OpenApeGrant, domain: string | undefined }[]> {
  const { grantStore } = useGrantStores()
  const now = Math.floor(Date.now() / 1000)
  if (writer.scope === 'personal') {
    const grants = (await Promise.all((await ownerRequesters(writer.key)).map(requester => grantStore.findByRequester(requester)))).flat()
    return grants.filter(grant => !grant.brokered && continuing(grant, now)).map(grant => ({ grant, domain: emailDomain(writer.key) }))
  }
  const grants: OpenApeGrant[] = []
  let cursor: string | undefined
  do {
    const page = await grantStore.listGrants({ status: 'approved', limit: 1000, ...(cursor ? { cursor } : {}) })
    grants.push(...page.data.filter(grant => !grant.brokered && continuing(grant, now)))
    cursor = page.pagination.has_more ? page.pagination.cursor ?? undefined : undefined
  } while (cursor)
  const { userStore } = useIdpStores()
  const domains = new Map<string, Promise<string | undefined>>()
  const domainOf = (requester: string) => {
    if (!domains.has(requester)) domains.set(requester, userStore.findByEmail(requester).then(user => emailDomain(user ? shapeOwnerOf(user) : undefined)))
    return domains.get(requester) as Promise<string | undefined>
  }
  return await Promise.all(grants.map(async grant => ({ grant, domain: await domainOf(grant.request.requester) })))
}

/** A batch member, or a refusal naming its position: one invalid adapter refuses the whole batch. */
function parseBatchShape(scope: ShapeTier, item: ImportBody['shapes'][number], index: number): ServerShape {
  try { return parseTierShape(scope, item.toml, item.description ?? '') }
  catch (error) {
    const problem = error as { statusMessage?: string, statusCode?: number }
    fail(`Shape ${index + 1}: ${problem.statusMessage ?? String(error)}; nothing was imported`, problem.statusCode ?? 400)
  }
}

/**
 * Previews or applies one batch of one tier, all or nothing. Without
 * `prune`, shapes of the tier the batch does not name stay; with it they are
 * removed. An unchanged repeat writes nothing.
 */
export async function importShapes(writer: ShapeWriter, body: unknown, dryRun: boolean): Promise<ShapeImportReport> {
  return (await serialized(() => importNow(writer, body, dryRun))).report
}

// Shape writes run one at a time in this process (the IdP runs as one process), so the state an import
// checks and audits against is the state it writes over.
let writes: Promise<unknown> = Promise.resolve()
function serialized<T>(write: () => Promise<T>): Promise<T> {
  const next = writes.then(write, write)
  writes = next.catch(() => undefined)
  return next
}

/** An import's report with what it read, so a single publish answers without reading again. */
interface ImportOutcome {
  report: ShapeImportReport
  incoming: ServerShape[]
  existing: ServerShape[]
  /** The grants the impact was computed from; null when nothing changed. */
  grants: OpenApeGrant[] | null
}

async function importNow(writer: ShapeWriter, body: unknown, dryRun: boolean, urlId?: string): Promise<ImportOutcome> {
  const store = tierStore()
  const input = readImportBody(body)
  const limit = SHAPE_LIMITS.perScope[writer.scope]
  if (input.shapes.length > limit) fail(`A ${writer.scope} import holds at most ${limit} shapes`, 413)
  const incoming = input.shapes.map((item, index) => parseBatchShape(writer.scope, item, index))
  if (urlId !== undefined && incoming[0]?.cli_id !== urlId) fail(`The adapter id ${JSON.stringify(incoming[0]?.cli_id)} differs from the shape id ${JSON.stringify(urlId)} in the URL`)
  // One program, one shape: a second shape for the same id or executable would leave the call resolved by whichever sorts first.
  incoming.forEach((shape, index) => {
    const twin = incoming.slice(0, index).find(other => shares(other, shape))
    if (twin) fail(`${shape.cli_id} and ${twin.cli_id} describe the same program; nothing was imported`, 409)
  })
  const existing = await listTier(store, writer)
  // A shape sent without a description keeps the stored one (a single publish never clears the registry text).
  input.shapes.forEach((item, index) => {
    const previous = existing.find(shape => shape.cli_id === incoming[index]!.cli_id)
    if (item.description === undefined && previous && writer.scope !== 'personal') incoming[index]!.description = previous.description
  })
  const incomingIds = new Set(incoming.map(shape => shape.cli_id))
  const removed = input.prune ? existing.filter(shape => !incomingIds.has(shape.cli_id)) : []
  const desktop = removed.find(shape => DESKTOP_OWN.has(shape.cli_id))
  // Without its virtual shape, the desktop operation would be read as an ordinary program call.
  if (desktop) fail(`Prune would remove ${desktop.cli_id}, an operation of the Pods desktop; nothing was imported`, 409)
  const kept = existing.filter(shape => !incomingIds.has(shape.cli_id) && !removed.includes(shape))
  for (const shape of incoming) {
    const clash = kept.find(other => shares(other, shape))
    if (clash) fail(`The ${writer.scope} shape ${clash.cli_id} already describes ${shape.executable}; remove it (or import with prune) before importing ${shape.cli_id}`, 409)
  }
  if (kept.length + incoming.length > limit) fail(`The ${writer.scope} tier holds at most ${limit} shapes`, 409)

  const now = Math.floor(Date.now() / 1000)
  const previousOf = new Map(existing.map(shape => [shape.cli_id, shape]))
  const report: ShapeImportReport = { scope: writer.scope, scope_key: writer.key || null, dry_run: dryRun, saved: false, added: [], rules_changed: [], text_changed: [], removed: removed.map(shape => shape.cli_id), unchanged: [], grants_losing_reuse: [], grants_keeping_reuse: [], overrides: [] }
  const save: ServerShape[] = []
  for (const shape of incoming) {
    const previous = previousOf.get(shape.cli_id)
    const list = !previous ? report.added : previous.digest !== shape.digest ? report.rules_changed : content(previous, writer.scope) !== content(shape, writer.scope) ? report.text_changed : report.unchanged
    list.push(shape.cli_id)
    if (list !== report.unchanged) save.push({ ...shape, ...(writer.scope === 'domain' ? { published_by: writer.actor } : {}), createdAt: previous?.createdAt ?? now, updatedAt: now })
  }

  const previousToml = writer.scope === 'instance' ? await lastInstanceToml(store, [...save.map(shape => shape.cli_id), ...report.removed].filter(cliId => previousOf.has(cliId))) : new Map<string, string>()
  const change = (action: ShapeChange['action'], previous: ServerShape | undefined, next: ServerShape | undefined): ShapeChange => ({
    scope: writer.scope,
    scope_key: writer.key,
    action,
    cli_id: (next ?? previous)?.cli_id ?? '',
    previous_digest: previous?.digest ?? null,
    digest: next?.digest ?? null,
    previous_toml: previous ? previous.toml ?? previousToml.get(previous.cli_id) ?? null : null,
    toml: next?.toml ?? null,
    source: input.source,
    actor: writer.actor,
    created_at: now,
  })
  const changes = [...save.map(shape => change(previousOf.has(shape.cli_id) ? 'update' : 'add', previousOf.get(shape.cli_id), shape)), ...removed.map(shape => change('remove', shape, undefined))]

  const grants = await describeImpact(report, writer, incoming, existing)
  if (!dryRun && changes.length) {
    await store.applyShapeChanges({ scope: writer.scope, scope_key: writer.key, save: save.map(({ toml, ...shape }) => writer.scope === 'instance' ? shape : { ...shape, toml }), remove: report.removed, changes })
    report.saved = true
    console.info(`[shapes] ${writer.actor} imported ${writer.scope}${writer.key ? ` ${writer.key}` : ''}: +${report.added.length} ~${report.rules_changed.length} rules ~${report.text_changed.length} text -${report.removed.length}${input.source?.commit ? ` from ${input.source.commit}` : ''}`)
  }
  return { report, incoming, existing, grants }
}

/** IdP-wide rows keep no TOML; the newest audit entry of a shape holds the last imported one. */
async function lastInstanceToml(store: ShapeStore, cliIds: string[]): Promise<Map<string, string>> {
  const entries = await Promise.all(cliIds.map(async cliId => [cliId, (await store.listShapeChanges?.('instance', '', 1, cliId))?.[0]?.toml] as const))
  return new Map(entries.filter((entry): entry is readonly [string, string] => typeof entry[1] === 'string'))
}

/** Fills in which continuing grants the write affects and which lower-tier shapes it newly hides. */
async function describeImpact(report: ShapeImportReport, writer: ShapeWriter, incoming: ServerShape[], existing: ServerShape[]): Promise<OpenApeGrant[] | null> {
  const changed = new Set([...report.rules_changed, ...report.removed])
  const added = incoming.filter(shape => report.added.includes(shape.cli_id) || report.rules_changed.includes(shape.cli_id))
  if (!changed.size && !added.length) return null
  const grants = await scopeGrants(writer)
  const own = `${writer.scope}:${writer.key}`
  const digestOf = new Map(existing.map(shape => [shape.cli_id, shape.digest]))
  for (const { grant } of grants) {
    if (grantTier(grant) !== own || !changed.has(affected(grant).cli_id)) continue
    // A personal or domain grant of an earlier digest already stopped being reused.
    if (writer.scope !== 'instance' && grant.request.execution_context?.adapter_digest !== digestOf.get(affected(grant).cli_id)) continue
    // IdP-wide approvals carry over rule changes and lose reuse only when their shape is removed.
    if (writer.scope === 'instance' && !report.removed.includes(affected(grant).cli_id)) report.grants_keeping_reuse.push(affected(grant))
    else report.grants_losing_reuse.push(affected(grant))
  }
  if (writer.scope === 'instance') return grants.map(entry => entry.grant)
  // What the writer's scope read before the write below this tier: for a domain the IdP-wide shapes, for an owner their domain's and the IdP-wide ones.
  const lower = await scopedShapeStore(useShapeStore(), writer.scope === 'personal' ? { domain: emailDomain(writer.key) } : {}).listShapes()
  for (const shape of added) {
    const before = existing.find(other => other.cli_id === shape.cli_id)
    for (const hidden of lower.filter(other => shares(other, shape) && !(before && shares(other, before)))) {
      const tier = hidden.domain ? 'domain' : 'instance'
      const hiddenTier = hidden.domain ? `domain:${hidden.domain}` : 'instance:'
      report.overrides.push({ cli_id: hidden.cli_id, tier, by: shape.cli_id, grants: grants.filter(entry => (writer.scope === 'personal' || entry.domain === writer.key) && grantTier(entry.grant) === hiddenTier && affected(entry.grant).cli_id === hidden.cli_id).map(entry => affected(entry.grant)) })
    }
  }
  return grants.map(entry => entry.grant)
}

function boundGrants(grants: OpenApeGrant[], writer: Pick<ShapeWriter, 'scope' | 'key'>, shape: Pick<ServerShape, 'cli_id' | 'digest'>): OwnerShapeGrant[] {
  const tier = `${writer.scope}:${writer.key}`
  return grants.filter(grant => grantTier(grant) === tier && affected(grant).cli_id === shape.cli_id)
    .map(grant => ({ ...affected(grant), digest_current: grant.request.execution_context?.adapter_digest === shape.digest }))
}

function view(shape: ServerShape, grants: OpenApeGrant[], writer: Pick<ShapeWriter, 'scope' | 'key'>): OwnerShapeView {
  return { cli_id: shape.cli_id, executable: shape.executable, digest: shape.digest, toml: shape.toml ?? null, description: shape.description, operations: shape.operations, created_at: shape.createdAt, published_at: shape.updatedAt, published_by: shape.published_by ?? null, bound_grants: boundGrants(grants, writer, shape) }
}

/**
 * One tier's shapes with the continuing grants bound to them. Domain members
 * who are not admins see only their own and their agents' grants.
 */
export async function listTierViews(reader: ShapeWriter & { admin: boolean }): Promise<OwnerShapeView[]> {
  const store = useShapeStore()
  const shapes = await listTier(store, reader)
  if (reader.scope === 'instance') return shapes.map(shape => view({ ...shape, toml: undefined }, [], reader))
  const grants = reader.scope === 'domain' && reader.admin
    ? (await scopeGrants(reader)).filter(entry => entry.domain === reader.key).map(entry => entry.grant)
    : (await scopeGrants({ scope: 'personal', key: reader.actor })).map(entry => entry.grant)
  return shapes.map(shape => view(shape, grants, reader))
}

/** The newest audited writes of one tier. */
export async function listTierChanges(reader: Pick<ShapeWriter, 'scope' | 'key'>, limit = 100): Promise<ShapeChange[]> {
  const store = useShapeStore()
  if (!store.listShapeChanges) fail('This identity provider does not store shape changes', 501)
  return await store.listShapeChanges(reader.scope, reader.key, limit)
}

/**
 * Publishes (or with `dryRun` only previews) one shape of one tier: an
 * import of exactly this shape without prune. The answer names the
 * continuing grants that stop being reused.
 */
export async function publishTierShape(writer: ShapeWriter, cliId: string, body: unknown, dryRun: boolean) {
  const { toml, description } = (body && typeof body === 'object' ? body : {}) as { toml?: unknown, description?: unknown }
  const { report, incoming, existing, grants } = await serialized(() => importNow(writer, { shapes: [{ toml, ...(description === undefined ? {} : { description }) }] }, dryRun, cliId))
  // importNow refused any other id, so the one shape is the URL's.
  const shape = incoming[0]!
  const previous = existing.find(item => item.cli_id === cliId) ?? null
  const bound = writer.scope === 'instance' ? [] : grants ?? (await scopeGrants(writer)).map(entry => entry.grant)
  const now = Math.floor(Date.now() / 1000)
  const stored = { ...shape, ...(writer.scope === 'domain' ? { published_by: writer.actor } : {}), createdAt: previous?.createdAt ?? now, updatedAt: report.saved || !previous ? now : previous.updatedAt }
  return { saved: report.saved, shape: view(stored, bound, writer), replaced_digest: previous?.digest ?? null, grants_losing_reuse: report.grants_losing_reuse, grants_keeping_reuse: report.grants_keeping_reuse, overrides: report.overrides }
}

/** Removes one shape of one tier, audited like an import. */
export async function removeTierShape(writer: ShapeWriter, cliId: string) {
  return await serialized(() => removeNow(writer, cliId))
}

async function removeNow(writer: ShapeWriter, cliId: string) {
  const store = tierStore()
  const previous = (await listTier(store, writer)).find(shape => shape.cli_id === cliId)
  if (!previous) fail(`There is no ${writer.scope} shape ${cliId}`, 404)
  if (writer.scope === 'instance' && DESKTOP_OWN.has(cliId)) fail(`${cliId} is an operation of the Pods desktop and cannot be removed`, 409)
  const grants = (await scopeGrants(writer)).map(entry => entry.grant)
  // IdP-wide grants bind no digest: every one of them stops covering once its shape is gone.
  const losing = boundGrants(grants, writer, previous).filter(grant => writer.scope === 'instance' || grant.digest_current)
  const now = Math.floor(Date.now() / 1000)
  const previousToml = previous.toml ?? (writer.scope === 'instance' ? (await lastInstanceToml(store, [cliId])).get(cliId) : undefined) ?? null
  await store.applyShapeChanges({ scope: writer.scope, scope_key: writer.key, save: [], remove: [cliId], changes: [{ scope: writer.scope, scope_key: writer.key, action: 'remove', cli_id: cliId, previous_digest: previous.digest, digest: null, previous_toml: previousToml, toml: null, source: null, actor: writer.actor, created_at: now }] })
  console.info(`[shapes] ${writer.actor} removed ${writer.scope} shape ${cliId} ${previous.digest}`)
  return { removed: true, grants_losing_reuse: losing.map(({ digest_current: _current, ...grant }) => grant) }
}
