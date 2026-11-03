import type { User } from '@openape/auth'
import type { OpenApeGrant, OpenApeGrantRequest } from '@openape/core'
import type { ServerShape, ShapeScope } from '@openape/grants'
import { brokerRequesterName, buildCliAuthDetail, canonicalizeCliPermission, computeArgvHash, emailDomain, GENERIC_OPERATION_ID, matchArgvToOperation, scopedShapeStore } from '@openape/grants'
import type { GrantCardContext, OwnerShapeCard, RegistryCard } from '../../utils/grant-card'
import { renderRegistryCard } from '../../utils/grant-card'
import { getCliAuthorizationDetails } from '../../utils/cli-grants'
import { useShapeStore } from './shape-store'
import { useIdpStores } from './stores'

/** Where the card's IdP-side facts come from; injectable for tests. */
export interface GrantCardSources {
  /** The shapes calls of `scope` are read with (`scopedShapeStore`); without a scope the IdP-wide shapes. */
  listShapes: (scope: ShapeScope) => Promise<ServerShape[]>
  findUser: (email: string) => Promise<User | null>
}

type GetShape = (cliId: string, scope: ShapeScope) => Promise<ServerShape | null>

/** The tier a grant was resolved with, as written by the IdP: personal (`adapter_owner`) or domain (`adapter_domain`). */
function contextScope(context: OpenApeGrantRequest['execution_context']): ShapeScope {
  return { ...(context?.adapter_owner ? { owner: context.adapter_owner } : {}), ...(context?.adapter_domain ? { domain: context.adapter_domain } : {}) }
}

function memoize<T>(load: (key: string) => Promise<T>): (key: string) => Promise<T> {
  const cache = new Map<string, Promise<T>>()
  return (key) => {
    if (!cache.has(key)) cache.set(key, load(key))
    return cache.get(key)!
  }
}

function sameArgv(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((token, index) => token === b[index])
}

/**
 * Whether the IdP resolved this grant itself (`POST /api/grants/authorize`):
 * only the IdP writes the program hash, POST /api/grants refuses it.
 */
function resolvedByIdp(request: OpenApeGrantRequest): boolean {
  return typeof request.execution_context?.program_sha256 === 'string'
}

/**
 * Registry meaning of a grant, or null for the generic fallback. Only an
 * adapter in this IdP's shapes table counts. A grant the IdP resolved itself
 * needs no client-sent adapter digest; a client-resolved grant must name
 * exactly that adapter file (digest) and executable. In both cases its argv
 * fits its hash and command, and the argv matches the same operation again
 * with the same permission. The card's values are the bindings derived here
 * from the argv, not the requester's `context_bindings`; values the
 * permission does not bind are marked as requested.
 */
export async function registryCard(request: OpenApeGrantRequest, getShape: GetShape): Promise<RegistryCard | null> {
  const details = getCliAuthorizationDetails(request.authorization_details)
  const context = request.execution_context
  const byIdp = resolvedByIdp(request)
  if (details.length !== 1 || !context) return null
  const detail = details[0]!
  if (!byIdp && (!context.adapter_digest || context.adapter_id !== detail.cli_id)) return null
  const argv = context.argv ?? request.command
  if (!argv?.length || (request.command && !sameArgv(request.command, argv))) return null
  if (context.argv_hash && context.argv_hash !== await computeArgvHash(argv)) return null
  const shape = await getShape(detail.cli_id, byIdp ? contextScope(context) : {})
  if (!shape) return null
  // A personal or domain shape speaks for this card only in the version and tier the grant was resolved
  // with, and a shape of another tier never speaks for it (a later override or removal).
  if (((shape.owner || shape.domain) && shape.digest !== context.adapter_digest) || (byIdp && (shape.owner !== context.adapter_owner || shape.domain !== context.adapter_domain))) return null
  if (!byIdp && (shape.digest !== context.adapter_digest || argv[0]!.split('/').pop() !== shape.executable)) return null
  const match = matchArgvToOperation(shape.operations, argv.slice(1))
  const presentation = match?.operation.presentation
  if (!match || !presentation || match.operation.id !== detail.operation_id) return null
  if (buildCliAuthDetail(shape.cli_id, match.operation, match.bindings).permission !== detail.permission) return null
  const exact = match.operation.exact_command === true && detail.constraints?.exact_command === true && !!context.argv_hash
  return renderRegistryCard({
    cliId: shape.cli_id,
    operationId: match.operation.id,
    presentation,
    bindings: match.bindings,
    bound: boundBindings(match.operation.resource_chain, match.bindings, exact),
    targetHost: request.target_host,
  })
}

/**
 * Bindings the approval holds to their value: those that become selectors of
 * the permission's resource chain, and every binding of an exact command,
 * whose whole argv the grant binds by hash.
 */
export function boundBindings(resourceChain: string[], bindings: Record<string, string>, exactCommand: boolean): Set<string> {
  if (exactCommand) return new Set(Object.keys(bindings))
  return new Set(resourceChain.flatMap(entry => Array.from(entry.matchAll(/\{([\w-]+)\}/g), ([, name]) => name!)))
}

/**
 * The program the IdP resolved the grant for. `version_tested` is false when
 * the adapter was chosen by the executable name only (owner decision 10);
 * a command no adapter describes has no version to test.
 */
export function programFacts(request: OpenApeGrantRequest): GrantCardContext['program'] {
  const context = request.execution_context
  if (!resolvedByIdp(request) || !context) return null
  const structured = getCliAuthorizationDetails(request.authorization_details).some(detail => detail.operation_id !== GENERIC_OPERATION_ID)
  return { sha256: context.program_sha256!, version_tested: structured ? context.version_tested === true : null }
}

/** The permission of an exact-command grant: the CLI name and the hash of its whole argv (`buildGenericResolvedServer`). */
function exactCommandPermission(cliId: string, argvHash: string): string {
  return canonicalizeCliPermission({ cli_id: cliId, resource_chain: [{ resource: 'cli', selector: { name: cliId } }, { resource: 'argv', selector: { hash: argvHash } }], action: 'exec' })
}

/**
 * Whether approving binds nothing but the request's command line, so a
 * requester title cannot widen it (owner decision, issue 1477). Fails closed:
 * every authorization detail must be an exact-only CLI detail whose permission
 * names the hash of exactly this command, and every permission must be that
 * permission. A command without details or permissions is bound by its
 * command hash. Anything else, such as a permission of another form or a
 * detail of another type, counts as broader.
 */
export async function bindsExactCommand(request: OpenApeGrantRequest): Promise<boolean> {
  const command = request.command
  if (!Array.isArray(command) || !command.length || command.some(token => typeof token !== 'string')) return false
  const context = request.execution_context
  if (context?.argv && !sameArgv(context.argv, command)) return false
  const argvHash = await computeArgvHash(command)
  if (context?.argv_hash && context.argv_hash !== argvHash) return false
  const details = request.authorization_details ?? []
  const permissions = request.permissions ?? []
  const allowed = new Set<string>()
  for (const detail of details) {
    if (detail.type !== 'openape_cli' || detail.constraints?.exact_command !== true) return false
    const expected = exactCommandPermission(detail.cli_id, argvHash)
    if (detail.permission !== expected || canonicalizeCliPermission(detail) !== expected) return false
    allowed.add(expected)
  }
  if (!details.length) allowed.add(exactCommandPermission(command[0]!.split('/').pop()!, argvHash))
  return permissions.every(permission => allowed.has(permission))
}

/** The tier a shape with these names overrides in `lower`, or null. */
function overriddenTier(shape: ServerShape, lower: ServerShape[]): OwnerShapeCard['overrides'] {
  const names = new Set([shape.cli_id, shape.executable])
  const hidden = lower.find(other => names.has(other.cli_id) || names.has(other.executable))
  return hidden ? hidden.domain ? 'domain' : 'instance' : null
}

/**
 * The personal or domain shape facts of a grant the IdP resolved with one
 * (`execution_context.adapter_owner` or `adapter_domain`, written only by the
 * IdP), or null.
 */
export async function ownerShapeCard(request: OpenApeGrantRequest, sources: Pick<GrantCardSources, 'listShapes'>): Promise<OwnerShapeCard | null> {
  const context = request.execution_context
  const detail = getCliAuthorizationDetails(request.authorization_details)[0]
  if (!resolvedByIdp(request) || (!context?.adapter_owner && !context?.adapter_domain) || !detail) return null
  const scope = contextScope(context)
  const shape = (await sources.listShapes(scope)).find(item => item.cli_id === detail.cli_id)
  const own = shape && shape.owner === scope.owner && shape.domain === scope.domain ? shape : null
  // What the shape hides: below a personal shape the owner's domain and the IdP-wide shapes, below a domain shape the IdP-wide ones.
  const lower = own ? await sources.listShapes(scope.owner ? { domain: emailDomain(scope.owner) } : {}) : []
  return {
    cli_id: detail.cli_id,
    tier: context.adapter_owner ? 'personal' : 'domain',
    owner: context.adapter_owner ?? null,
    domain: context.adapter_owner ? null : context.adapter_domain ?? null,
    published_by: own?.published_by ?? null,
    overrides: own ? overriddenTier(own, lower) : null,
    digest: context.adapter_digest,
    published_at: own?.updatedAt ?? null,
    current: own?.digest === context.adapter_digest,
    operation_id: detail.operation_id,
    operations: (own?.operations ?? []).map(operation => ({ id: operation.id, command: operation.command, display: operation.display, action: operation.action, risk: operation.risk })),
  }
}

function defaultSources(): GrantCardSources {
  const shapeStore = useShapeStore()
  const { userStore } = useIdpStores()
  return { listShapes: scope => scopedShapeStore(shapeStore, scope).listShapes(), findUser: email => userStore.findByEmail(email) }
}

/** Adds `card` (registry meaning and the requester's registration) to each grant. */
export async function withGrantCards<T extends OpenApeGrant>(grants: T[], sources: GrantCardSources = defaultSources()): Promise<(T & { card: GrantCardContext })[]> {
  const cachedList = memoize(key => sources.listShapes(JSON.parse(key) as ShapeScope))
  const listShapes: GrantCardSources['listShapes'] = scope => cachedList(JSON.stringify({ owner: scope.owner, domain: scope.domain }))
  const getShape: GetShape = async (cliId, scope) => (await listShapes(scope)).find(shape => shape.cli_id === cliId) ?? null
  const findUser = memoize(sources.findUser)
  return await Promise.all(grants.map(async (grant) => {
    const [registry, user, exactCommand, ownerShape] = await Promise.all([registryCard(grant.request, getShape), grant.brokered ? null : findUser(grant.request.requester), bindsExactCommand(grant.request), ownerShapeCard(grant.request, { listShapes })])
    const providerName = brokerRequesterName(grant.brokered?.requester_name)
    const requester = grant.brokered ? providerName ? { name: providerName, owner: grant.brokered.owner } : null : user ? { name: user.name, owner: user.owner ?? null } : null
    return { ...grant, card: { registry, requester, program: programFacts(grant.request), binds_exact_command: exactCommand, owner_shape: ownerShape } }
  }))
}
