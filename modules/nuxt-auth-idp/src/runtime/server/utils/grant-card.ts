import type { User } from '@openape/auth'
import type { OpenApeGrant, OpenApeGrantRequest } from '@openape/core'
import type { ServerShape } from '@openape/grants'
import { buildCliAuthDetail, computeArgvHash, GENERIC_OPERATION_ID, matchArgvToOperation } from '@openape/grants'
import type { GrantCardContext, RegistryCard } from '../../utils/grant-card'
import { renderRegistryCard } from '../../utils/grant-card'
import { getCliAuthorizationDetails } from '../../utils/cli-grants'
import { useShapeStore } from './shape-store'
import { useIdpStores } from './stores'

/** Where the card's IdP-side facts come from; injectable for tests. */
export interface GrantCardSources {
  getShape: (cliId: string) => Promise<ServerShape | null>
  findUser: (email: string) => Promise<User | null>
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
export async function registryCard(request: OpenApeGrantRequest, getShape: GrantCardSources['getShape']): Promise<RegistryCard | null> {
  const details = getCliAuthorizationDetails(request.authorization_details)
  const context = request.execution_context
  const byIdp = resolvedByIdp(request)
  if (details.length !== 1 || !context) return null
  const detail = details[0]!
  if (!byIdp && (!context.adapter_digest || context.adapter_id !== detail.cli_id)) return null
  const argv = context.argv ?? request.command
  if (!argv?.length || (request.command && !sameArgv(request.command, argv))) return null
  if (context.argv_hash && context.argv_hash !== await computeArgvHash(argv)) return null
  const shape = await getShape(detail.cli_id)
  if (!shape) return null
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

function defaultSources(): GrantCardSources {
  const shapeStore = useShapeStore()
  const { userStore } = useIdpStores()
  return { getShape: cliId => shapeStore.getShape(cliId), findUser: email => userStore.findByEmail(email) }
}

/** Adds `card` (registry meaning and the requester's registration) to each grant. */
export async function withGrantCards<T extends OpenApeGrant>(grants: T[], sources: GrantCardSources = defaultSources()): Promise<(T & { card: GrantCardContext })[]> {
  const getShape = memoize(sources.getShape)
  const findUser = memoize(sources.findUser)
  return await Promise.all(grants.map(async (grant) => {
    const [registry, user] = await Promise.all([registryCard(grant.request, getShape), findUser(grant.request.requester)])
    return { ...grant, card: { registry, requester: user ? { name: user.name, owner: user.owner ?? null } : null, program: programFacts(grant.request) } }
  }))
}
