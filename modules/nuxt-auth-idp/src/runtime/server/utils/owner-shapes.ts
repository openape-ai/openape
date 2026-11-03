import type { OpenApeGrant } from '@openape/core'
import type { ServerShape, ShapeStore } from '@openape/grants'
import { assertResourceChainTemplates, buildCliAuthDetail } from '@openape/grants'
import { parseAdapterToml, semanticAdapterDigest } from '@openape/shapes'
import { useGrantStores } from './grant-stores'
import { createProblemError } from './problem'
import { useShapeStore } from './shape-store'
import { useIdpStores } from './stores'

/**
 * Owner-published shapes (issue 1551): a human owner publishes the adapter of
 * a tool they built for their own agents. The registry stays the only shared
 * source; an owner shape never takes a registry id or executable.
 */
export const OWNER_SHAPE_LIMITS = { tomlBytes: 64 * 1024, shapesPerOwner: 50 } as const

/** Operations the Pods desktop performs itself; no program may be published under these names. */
const RESERVED = new Set(['pod-runtime', 'pod-http', 'pod-ssh'])
const CLI_NAME = /^[a-z0-9][\w.-]{0,63}$/i

/** A grant whose reuse depends on an owner shape: approved, continuing, resolved with it. */
export interface OwnerShapeGrant {
  id: string
  requester: string
  operation_id: string
  grant_type: string
  decided_at: number | null
  /** False when the grant was approved for another version (digest) of the shape. */
  digest_current: boolean
}

export interface OwnerShapeView {
  cli_id: string
  executable: string
  digest: string
  toml: string | null
  operations: ServerShape['operations']
  created_at: number
  published_at: number
  bound_grants: OwnerShapeGrant[]
}

function requireStore(): Required<Pick<ShapeStore, 'listOwnerShapes' | 'saveOwnerShape' | 'deleteOwnerShape'>> & ShapeStore {
  const store = useShapeStore()
  if (!store.listOwnerShapes || !store.saveOwnerShape || !store.deleteOwnerShape)
    throw createProblemError({ status: 501, title: 'This identity provider does not store owner shapes' })
  return store as ReturnType<typeof requireStore>
}

function fail(title: string, status = 400): never {
  throw createProblemError({ status, title })
}

/**
 * Parses an adapter with the same strict parser and semantic digest as the
 * registry, apes and the Pods desktop, and refuses what an owner may not
 * publish: another id than the URL names, registry ids or executables,
 * reserved names, registry-only version facts, `_` operation ids (the generic
 * fallback) and resource chains the matcher could not render.
 */
export async function parseOwnerShape(cliId: string, toml: unknown, owner: string): Promise<ServerShape> {
  if (typeof toml !== 'string' || !toml.trim()) fail('Body must be {"toml": "<adapter.toml content>"}')
  if (Buffer.byteLength(toml) > OWNER_SHAPE_LIMITS.tomlBytes) fail(`The adapter exceeds ${OWNER_SHAPE_LIMITS.tomlBytes} bytes`, 413)
  let adapter: ReturnType<typeof parseAdapterToml>
  try { adapter = parseAdapterToml(toml) }
  catch (error) { fail(`Invalid adapter: ${error instanceof Error ? error.message : String(error)}`) }
  const { id, executable } = adapter.cli
  if (id !== cliId) fail(`The adapter id ${JSON.stringify(id)} differs from the shape id ${JSON.stringify(cliId)} in the URL`)
  for (const name of [id, executable]) {
    if (!CLI_NAME.test(name) || name.includes('/')) fail(`${JSON.stringify(name)} must be a plain program name`)
    if (RESERVED.has(name)) fail(`${name} is reserved for the Pods desktop`, 409)
  }
  if (adapter.cli.tested_digests || adapter.cli.tested_versions || adapter.cli.version_command || adapter.cli.version_pattern)
    fail('tested_digests and tested versions are registry facts; remove them from an owner shape')
  if (!adapter.operations.length) fail('The adapter declares no operation')
  const ids = new Set<string>()
  for (const operation of adapter.operations) {
    if (operation.id.startsWith('_')) fail(`Operation id ${operation.id} is reserved`)
    // The resolver reads an operation's policy by id: a duplicate would let a later `deny` or `once` be read from an earlier one.
    if (ids.has(operation.id)) fail(`Operation id ${operation.id} is declared twice`)
    ids.add(operation.id)
    try {
      assertResourceChainTemplates(operation.resource_chain)
      // Render with exactly the bindings every match sets (positionals and required options), so a
      // template naming an optional or unknown binding, or an unsupported transform, fails now
      // instead of failing the first matching call with 500.
      const always = [...(operation.positionals ?? []).filter(name => !name.startsWith('=')), ...(operation.required_options ?? [])]
      buildCliAuthDetail(id, operation, Object.fromEntries(always.map(name => [name, 'owner/name'])))
    }
    catch (error) { fail(`Operation ${operation.id}: ${error instanceof Error ? error.message : String(error)} (templates may use positionals and required options)`) }
  }
  const registry = await useShapeStore().listShapes()
  const taken = registry.find(shape => [shape.cli_id, shape.executable].some(name => name === id || name === executable))
  if (taken) fail(`The shapes-registry already describes ${taken.cli_id}; use or extend the registry shape`, 409)
  const now = Math.floor(Date.now() / 1000)
  const previous = (await requireStore().listOwnerShapes(owner)).find(shape => shape.cli_id === cliId)
  return {
    cli_id: id,
    executable,
    description: '',
    operations: adapter.operations,
    source: 'custom',
    owner,
    digest: semanticAdapterDigest(adapter),
    toml,
    createdAt: previous?.createdAt ?? now,
    updatedAt: now,
  }
}

/** Every agent of the owner plus the owner, the requesters whose calls read the owner's shapes. */
async function ownerGrants(owner: string): Promise<OpenApeGrant[]> {
  const { userStore } = useIdpStores()
  const { grantStore } = useGrantStores()
  const requesters = [owner, ...(await userStore.findByOwner(owner)).map(user => user.email)]
  return (await Promise.all(requesters.map(requester => grantStore.findByRequester(requester)))).flat()
}

function boundGrants(grants: OpenApeGrant[], owner: string, shape: Pick<ServerShape, 'cli_id' | 'digest'>): OwnerShapeGrant[] {
  const now = Math.floor(Date.now() / 1000)
  return grants.flatMap((grant) => {
    const context = grant.request.execution_context
    const detail = grant.request.authorization_details?.find(detail => detail.type === 'openape_cli')
    if (grant.status !== 'approved' || (grant.expires_at && grant.expires_at <= now) || (grant.request.grant_type ?? 'once') === 'once') return []
    if (context?.adapter_owner !== owner || detail?.type !== 'openape_cli' || detail.cli_id !== shape.cli_id) return []
    return [{ id: grant.id, requester: grant.request.requester, operation_id: detail.operation_id, grant_type: grant.request.grant_type ?? 'once', decided_at: grant.decided_at ?? null, digest_current: context.adapter_digest === shape.digest }]
  })
}

function view(shape: ServerShape, grants: OpenApeGrant[], owner: string): OwnerShapeView {
  return { cli_id: shape.cli_id, executable: shape.executable, digest: shape.digest, toml: shape.toml ?? null, operations: shape.operations, created_at: shape.createdAt, published_at: shape.updatedAt, bound_grants: boundGrants(grants, owner, shape) }
}

export async function listOwnerShapeViews(owner: string): Promise<OwnerShapeView[]> {
  const [shapes, grants] = await Promise.all([requireStore().listOwnerShapes(owner), ownerGrants(owner)])
  return shapes.map(shape => view(shape, grants, owner))
}

/**
 * Publishes (or with `dryRun` only previews) an owner shape. The answer names
 * the continuing grants that stop being reused because the digest changes.
 */
export async function publishOwnerShape(owner: string, cliId: string, toml: unknown, dryRun: boolean) {
  const store = requireStore()
  const shape = await parseOwnerShape(cliId, toml, owner)
  const existing = await store.listOwnerShapes(owner)
  const previous = existing.find(item => item.cli_id === cliId) ?? null
  if (!previous && existing.length >= OWNER_SHAPE_LIMITS.shapesPerOwner) fail(`An owner can publish at most ${OWNER_SHAPE_LIMITS.shapesPerOwner} shapes`, 409)
  const grants = await ownerGrants(owner)
  const losing = previous && previous.digest !== shape.digest ? boundGrants(grants, owner, previous).filter(grant => grant.digest_current) : []
  if (!dryRun) {
    await store.saveOwnerShape(owner, shape)
    console.info(`[shapes] ${owner} published owner shape ${cliId} ${shape.digest}${previous ? ` replacing ${previous.digest}` : ''}`)
  }
  return { saved: !dryRun, shape: view(shape, grants, owner), replaced_digest: previous?.digest ?? null, grants_losing_reuse: losing }
}

export async function removeOwnerShape(owner: string, cliId: string) {
  const store = requireStore()
  const previous = (await store.listOwnerShapes(owner)).find(item => item.cli_id === cliId)
  if (!previous) fail(`You have no shape ${cliId}`, 404)
  const losing = boundGrants(await ownerGrants(owner), owner, previous).filter(grant => grant.digest_current)
  await store.deleteOwnerShape(owner, cliId)
  console.info(`[shapes] ${owner} removed owner shape ${cliId} ${previous.digest}`)
  return { removed: true, grants_losing_reuse: losing }
}
