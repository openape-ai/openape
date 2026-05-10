import { eq } from 'drizzle-orm'
import { z } from 'zod'
import toolCatalog from '../../../tool-catalog.json'
import { useDb } from '../../../database/drizzle'
import { agents } from '../../../database/schema'
import { parseAgentEmail } from '../../../utils/agent-email'
import { requireAgent } from '../../../utils/auth'

// Default tool whitelist for first-time agent sync — all currently-
// shipped tools are enabled. Owners narrow via the troop UI later.
const ALL_TOOL_NAMES: string[] = (toolCatalog as { tools: Array<{ name: string }> }).tools.map(t => t.name)

const bodySchema = z.object({
  hostname: z.string().min(1).max(253),
  // IOPlatformUUID is canonical 8-4-4-4-12 hex with dashes, but we
  // keep validation lenient — different hardware identifiers may
  // produce different formats and we don't want to break agent
  // registration over a regex difference. Cap on length only.
  host_id: z.string().min(8).max(128),
  // The agent was provisioned by its owner via `apes agents spawn`,
  // so the owner's email is known on the agent host. Posting it
  // here lets troop associate the agent with the right owner; the
  // ownerDomain part is also encoded in the agent's own email and
  // we cross-check the two below.
  owner_email: z.string().email(),
  pubkey_ssh: z.string().min(20).max(4000).optional(),
})

// Agent self-introduction. Called on first sync (after spawn) and
// on every subsequent sync. First sync pins host_id; subsequent
// syncs must match the pinned value or get 401 — that's the cheap
// "this keypair was copied to another machine" alarm.
export default defineEventHandler(async (event) => {
  const agentEmail = await requireAgent(event)
  const parsed = parseAgentEmail(agentEmail)
  if (!parsed) {
    throw createError({ statusCode: 400, statusMessage: 'agent email does not match the agent+name+ownerdomain pattern' })
  }

  const body = bodySchema.safeParse(await readBody(event))
  if (!body.success) {
    throw createError({ statusCode: 400, statusMessage: body.error.issues[0]?.message ?? 'invalid body' })
  }

  // Cross-check: the agent's email encodes the owner's domain, which
  // must match the owner email's domain. Catches typos and mostly
  // also catches "agent X tries to claim itself for owner@elsewhere".
  const postedDomain = body.data.owner_email.split('@')[1]?.toLowerCase()
  if (postedDomain !== parsed.ownerDomain) {
    throw createError({
      statusCode: 400,
      statusMessage: `owner_email domain (${postedDomain}) does not match agent email's encoded owner-domain (${parsed.ownerDomain})`,
    })
  }

  const db = useDb()
  const now = Math.floor(Date.now() / 1000)
  const existing = await db
    .select()
    .from(agents)
    .where(eq(agents.email, agentEmail))
    .get()

  if (existing) {
    // Pinned hostId mismatch is the keypair-was-copied alarm. Refuse
    // to update anything; the agent owner needs to either re-spawn
    // (regenerating keypair) or, in a future iteration, explicitly
    // reset the pin via an owner-side endpoint.
    if (existing.hostId && existing.hostId !== body.data.host_id) {
      throw createError({
        statusCode: 401,
        statusMessage: 'host_id mismatch: agent keypair appears to have moved to a different host',
      })
    }
    // Backfill tools[] for legacy rows that existed before the
    // tool-whitelist column was added (their migration default was
    // empty []). New rows go through the insert path below which
    // seeds all-tools by default; existing rows would otherwise be
    // stuck on []. We only backfill when the row is currently empty
    // — owners that explicitly narrowed to a non-empty subset keep
    // their settings.
    const toolsBackfill = (existing.tools?.length ?? 0) === 0 ? ALL_TOOL_NAMES : existing.tools
    await db.update(agents).set({
      hostId: body.data.host_id,
      hostname: body.data.hostname,
      ownerEmail: body.data.owner_email.toLowerCase(),
      pubkeySsh: body.data.pubkey_ssh ?? existing.pubkeySsh,
      tools: toolsBackfill,
      lastSeenAt: now,
    }).where(eq(agents.email, agentEmail))
    return { agent_email: agentEmail, host_id: body.data.host_id, first_sync: false, last_seen_at: now }
  }

  await db.insert(agents).values({
    email: agentEmail,
    ownerEmail: body.data.owner_email.toLowerCase(),
    agentName: parsed.agentName,
    hostId: body.data.host_id,
    hostname: body.data.hostname,
    pubkeySsh: body.data.pubkey_ssh ?? null,
    // Default-all-tools on first sync. Owner can later narrow via UI.
    tools: ALL_TOOL_NAMES,
    firstSeenAt: now,
    lastSeenAt: now,
    createdAt: now,
  })
  return { agent_email: agentEmail, host_id: body.data.host_id, first_sync: true, last_seen_at: now }
})
