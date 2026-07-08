import { eq } from 'drizzle-orm'
import { useDb } from '../../database/drizzle'
import { organizations } from '../../database/schema'
import { cockpitOwner } from '../../utils/cockpit/auth'

function accentFor(name: string): string {
  let h = 0
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0
  return `hsl(${h % 360} 62% 58%)`
}
function shortFor(name: string): string {
  const p = name.trim().split(/\s+/).filter(Boolean)
  return ((p[0]?.[0] ?? '?') + (p[1]?.[0] ?? p[0]?.[1] ?? '')).toUpperCase()
}

// The owner's troop orgs — live from troop's own DB, owner-scoped. No sync, no push.
export default defineEventHandler(async (event) => {
  const owner = await cockpitOwner(event)
  const db = useDb()
  const rows = await db.select().from(organizations).where(eq(organizations.ownerEmail, owner))
  return rows.map(o => ({ id: o.id, name: o.name, short: shortFor(o.name), accent: accentFor(o.name) }))
})
