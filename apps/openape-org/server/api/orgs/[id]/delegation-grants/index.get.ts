import { and, eq, isNull } from 'drizzle-orm'
import { useDb } from '../../../../database/drizzle'
import { delegationGrants } from '../../../../database/schema'
import { requireOwnedOrg } from '../../../../utils/orgs'

// List the active delegation grants the Owner has bound to this org.
// One row per audience (today only 'apes-cli' / troop, but Sanierer
// reading LiteLLM cost log may want its own grant later).
export default defineEventHandler(async (event) => {
  const { owner } = await requireOwnedOrg(event)
  const db = useDb()
  return db.select()
    .from(delegationGrants)
    .where(and(
      eq(delegationGrants.ownerEmail, owner.toLowerCase()),
      isNull(delegationGrants.revokedAt),
    ))
})
