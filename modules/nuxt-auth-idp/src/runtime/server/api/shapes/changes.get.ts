import { defineEventHandler, getQuery } from 'h3'
import { createProblemError } from '../../utils/problem'
import { listTierChanges } from '../../utils/shape-tiers'
import { readShapeScope, requireShapeReader } from '../../utils/shape-writer'

/**
 * GET /api/shapes/changes?scope=instance|domain|personal[&limit=n]
 *
 * The newest audited writes of one tier (issue 1553): IdP-wide history for
 * every signed-in human, a domain's history for its root admins and
 * operators, personal history for the owner.
 */
export default defineEventHandler(async (event) => {
  const scope = readShapeScope(event)
  const reader = scope === 'instance' ? { ...await requireShapeReader(event, 'personal'), scope, key: '' } : await requireShapeReader(event, scope)
  if (!reader.admin) throw createProblemError({ status: 403, title: 'Only a root admin or operator of your domain reads its shape history' })
  const limit = Math.min(Math.max(Number(getQuery(event).limit) || 100, 1), 500)
  return await listTierChanges(reader, limit)
})
