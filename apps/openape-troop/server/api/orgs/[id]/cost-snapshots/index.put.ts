import { z } from 'zod'
import { sql } from 'drizzle-orm'
import { useDb } from '../../../../database/drizzle'
import { requireOwnedOrg } from '../../../../utils/orgs'

const Body = z.object({
  day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  tokens_in: z.number().int().min(0),
  tokens_out: z.number().int().min(0),
  inference_cost_cents: z.number().int().min(0),
  infra_cost_cents: z.number().int().min(0).optional().default(0),
  output_artifacts_count: z.number().int().min(0).optional().default(0),
})

// Upsert per (org, day). Used by Sanierer (M3) to write daily roll-ups;
// today the Owner can also seed test data via UI for the cost dashboard
// to render meaningful numbers.
export default defineEventHandler(async (event) => {
  const { org } = await requireOwnedOrg(event)
  const body = await readBody(event)
  const parsed = Body.safeParse(body)
  if (!parsed.success) throw createError({ statusCode: 400, statusMessage: 'invalid body', data: parsed.error.flatten() })

  const now = Math.floor(Date.now() / 1000)
  await useDb().run(sql`
    INSERT INTO cost_snapshots (org_id, day, tokens_in, tokens_out, inference_cost_cents, infra_cost_cents, output_artifacts_count, updated_at)
    VALUES (${org.id}, ${parsed.data.day}, ${parsed.data.tokens_in}, ${parsed.data.tokens_out}, ${parsed.data.inference_cost_cents}, ${parsed.data.infra_cost_cents}, ${parsed.data.output_artifacts_count}, ${now})
    ON CONFLICT(org_id, day) DO UPDATE SET
      tokens_in = excluded.tokens_in,
      tokens_out = excluded.tokens_out,
      inference_cost_cents = excluded.inference_cost_cents,
      infra_cost_cents = excluded.infra_cost_cents,
      output_artifacts_count = excluded.output_artifacts_count,
      updated_at = excluded.updated_at
  `)
  return { ok: true }
})
