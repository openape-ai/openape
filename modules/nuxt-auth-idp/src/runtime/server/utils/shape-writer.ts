import type { H3Event } from 'h3'
import type { ShapeTier } from '@openape/grants'
import { emailDomain } from '@openape/grants'
import { getHeader, getQuery } from 'h3'
import { hasValidManagementToken } from './admin'
import { requireBrokerOwner } from './broker-owner'
import { createProblemError } from './problem'

/** Who writes or reads one tier: the tier, its key (`''`, the domain or the owner) and the accountable actor. */
export interface ShapeWriter {
  scope: ShapeTier
  key: string
  actor: string
}

const TIERS = new Set<ShapeTier>(['instance', 'domain', 'personal'])

/** `?scope=instance|domain|personal`; `fallback` when the query names none, 400 for anything else. */
export function readShapeScope(event: H3Event, fallback?: ShapeTier): ShapeTier {
  const value = getQuery(event).scope
  if (value === undefined && fallback) return fallback
  if (typeof value !== 'string' || !TIERS.has(value as ShapeTier))
    throw createProblemError({ status: 400, title: 'scope must be instance, domain or personal' })
  return value as ShapeTier
}

/**
 * A direct human (bearer token without delegation, or a session whose
 * writes carry this IdP's Origin) whom the app's admin resolver confirms as
 * root admin or operator; the domain is always their own email domain, never
 * a request parameter (issue 1553).
 */
async function requireDomainAdmin(event: H3Event, write: boolean): Promise<ShapeWriter> {
  const subject = await requireBrokerOwner(event, write)
  const domain = emailDomain(subject)
  const resolver = event.context.openapeAdminResolver
  if (!domain || !resolver || !await resolver(event, subject))
    throw createProblemError({ status: 403, title: `Only a root admin or operator of ${domain ?? 'your domain'} manages its domain shapes` })
  return { scope: 'domain', key: domain, actor: subject }
}

/**
 * The writer of one tier, or a refusal: IdP-wide shapes only with the
 * management token, domain shapes only by a root admin or operator of their
 * own domain, personal shapes only by the direct human owner. Agents, Pods,
 * delegations and brokered sessions never write.
 */
export async function requireShapeWriter(event: H3Event, scope: ShapeTier): Promise<ShapeWriter> {
  if (scope === 'instance') {
    if (hasValidManagementToken(event)) return { scope, key: '', actor: '_management_' }
    throw createProblemError({ status: getHeader(event, 'authorization') ? 403 : 401, title: 'IdP-wide shapes are written only with the management token' })
  }
  if (scope === 'domain') return await requireDomainAdmin(event, true)
  const owner = await requireBrokerOwner(event, true)
  return { scope, key: owner, actor: owner }
}

/**
 * Who reads one tier's shapes and history: IdP-wide ones are public; a
 * domain's shapes every direct human of that domain (`admin` when they may
 * also see its grants and history); personal ones the owner.
 */
export async function requireShapeReader(event: H3Event, scope: ShapeTier): Promise<ShapeWriter & { admin: boolean }> {
  if (scope === 'instance') return { scope, key: '', actor: '', admin: false }
  const subject = await requireBrokerOwner(event)
  if (scope === 'personal') return { scope, key: subject, actor: subject, admin: true }
  const domain = emailDomain(subject)
  if (!domain) throw createProblemError({ status: 403, title: 'Your account has no email domain' })
  const resolver = event.context.openapeAdminResolver
  return { scope, key: domain, actor: subject, admin: !!resolver && await resolver(event, subject) }
}
