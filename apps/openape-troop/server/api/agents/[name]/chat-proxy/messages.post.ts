import { z } from 'zod'
import { ofetch } from 'ofetch'
import { requireOwner } from '../../../../utils/auth'

// POST /api/agents/<name>/chat-proxy/messages — send a message to the
// agent. Proxies through to chat.openape.ai's POST /api/rooms/<id>/messages.

const bodySchema = z.object({
  room_id: z.string().uuid(),
  thread_id: z.string().uuid(),
  body: z.string().min(1).max(10_000),
})

export default defineEventHandler(async (event) => {
  await requireOwner(event)
  const parsed = bodySchema.safeParse(await readBody(event))
  if (!parsed.success) {
    throw createError({ statusCode: 400, statusMessage: parsed.error.message })
  }

  const chatBase = (useRuntimeConfig().public.chatUrl as string | undefined)
    ?? 'https://chat.openape.ai'
  const cookie = getHeader(event, 'cookie') ?? ''

  try {
    return await ofetch(`${chatBase}/api/rooms/${parsed.data.room_id}/messages`, {
      method: 'POST',
      headers: { cookie },
      body: { body: parsed.data.body, thread_id: parsed.data.thread_id },
    })
  }
  catch (err) {
    const status = (err as { status?: number }).status ?? 502
    throw createError({
      statusCode: status,
      statusMessage: `chat.openape.ai POST failed (status ${status})`,
    })
  }
})
