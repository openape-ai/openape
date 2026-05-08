import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { useDb } from '../../../../database/drizzle'
import { runs } from '../../../../database/schema'
import { requireAgent } from '../../../../utils/auth'

const TRACE_CAP_BYTES = 16 * 1024

const bodySchema = z.object({
  status: z.enum(['ok', 'error']),
  final_message: z.string().max(8000).nullable(),
  step_count: z.number().int().min(0).max(1000),
  trace: z.unknown().optional(),
})

// Final-state PATCH on a run record. Trace is JSON-serialised and
// truncated at 16KB so a noisy run can't blow up the runs table.
// Truncation is naive byte-cap on the JSON string; the UI shows the
// truncated payload + a "(truncated)" note.
export default defineEventHandler(async (event) => {
  const agentEmail = await requireAgent(event)
  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, statusMessage: 'id required' })

  const body = bodySchema.safeParse(await readBody(event))
  if (!body.success) {
    throw createError({ statusCode: 400, statusMessage: body.error.issues[0]?.message ?? 'invalid body' })
  }

  let traceJson: string | null = null
  if (body.data.trace !== undefined) {
    let s: string
    try { s = JSON.stringify(body.data.trace) }
    catch { s = '"<unserialisable trace>"' }
    if (Buffer.byteLength(s, 'utf8') > TRACE_CAP_BYTES) {
      // Slice in code units (close enough — any partial unicode is
      // dropped, but the JSON.parse on the consumer side runs against
      // best-effort) then mark it truncated.
      const sliced = s.slice(0, TRACE_CAP_BYTES - 64)
      traceJson = JSON.stringify({ truncated: true, slice: sliced })
    }
    else {
      traceJson = s
    }
  }

  const result = await useDb()
    .update(runs)
    .set({
      status: body.data.status,
      finalMessage: body.data.final_message,
      stepCount: body.data.step_count,
      finishedAt: Math.floor(Date.now() / 1000),
      ...(traceJson !== null ? { trace: JSON.parse(traceJson) as unknown } : {}),
    })
    .where(and(eq(runs.id, id), eq(runs.agentEmail, agentEmail)))
    .returning()

  if (result.length === 0) {
    throw createError({ statusCode: 404, statusMessage: 'run not found or not owned by this agent' })
  }
  return result[0]
})
