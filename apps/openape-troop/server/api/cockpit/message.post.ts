import { and, eq } from 'drizzle-orm'
import { useDb } from '../../database/drizzle'
import { cockpitAgents, objectives, organizations } from '../../database/schema'
import { cockpitOwner } from '../../utils/cockpit/auth'
import { buildSystemPrompt } from '../../utils/cockpit/system-prompt'
import { abort, agentStatus, cleanup, enqueue, getTask, isClaimed } from '../../utils/cockpit/queue'

const HARD_WAIT_MS = 180000 // give a present-but-idle brain this long to claim before we call it offline
const WAIT_EMIT_EVERY_MS = 3000 // refresh the Ruhemodus countdown this often
const MAX_STREAM_MS = 120000
const WAIT_TEXT = '💤 CEO im Ruhemodus'
const OFFLINE_TEXT = 'Dein CEO ist gerade offline — sobald der reaktive Loop läuft, beantwortet er deine Frage.'
const delay = (ms: number) => new Promise(r => setTimeout(r, ms))

// Split into word-sized tokens, keeping trailing whitespace/newlines intact.
const tokenize = (text: string): string[] => text.match(/\S+\s*|\s+/g) ?? [text]

export default defineEventHandler(async (event) => {
  const owner = await cockpitOwner(event)
  const body = await readBody<{ company?: string, messages?: { role: string, content: string }[] }>(event)
  const company = body?.company ?? ''
  const db = useDb()
  const [org] = await db.select().from(organizations).where(and(eq(organizations.id, company), eq(organizations.ownerEmail, owner)))
  if (!org) throw createError({ statusCode: 404, statusMessage: 'unknown company' })
  const objs = await db.select().from(objectives).where(eq(objectives.orgId, company))
  const teamRows = await db.select().from(cockpitAgents).where(and(eq(cockpitAgents.ownerEmail, owner), eq(cockpitAgents.orgId, company)))
  const team = teamRows.filter(t => t.enabled).map(t => ({ role: t.role, label: t.label, duties: t.duties, tools: t.tools }))

  const userMessage = [...(body?.messages ?? [])].reverse().find(m => m.role === 'user')?.content ?? ''
  const task = enqueue(company, buildSystemPrompt(org, objs, owner, team), userMessage, owner)

  setResponseHeaders(event, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache, no-transform',
    'connection': 'keep-alive',
  })

  let clientGone = false
  event.node.req.on('close', () => { clientGone = true; abort(task.id) })
  const encoder = new TextEncoder()

  return new ReadableStream({
    async start(controller) {
      const emit = (obj: unknown) => {
        try { controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`)) }
        catch { /* stream closed */ }
      }
      try {
        // Wait for the owner's CEO brain to claim the task. We never fake an
        // answer: if a brain is present we wait for it (showing "übernimmt" when
        // it's awake, a live "Ruhemodus" countdown when it's sleeping); only if
        // no brain is reachable do we return an honest offline notice.
        const first = agentStatus(owner)
        if (first.mode !== 'offline') {
          if (first.mode === 'idle' && first.nextPollInSec != null)
            emit({ k: 'wait', text: WAIT_TEXT, sec: first.nextPollInSec })
          else
            emit({ k: 'think', text: '🧠 Dein CEO übernimmt …' })

          const waitStart = Date.now()
          let nextEmit = Date.now() + WAIT_EMIT_EVERY_MS
          // eslint-disable-next-line no-unmodified-loop-condition -- clientGone is flipped by the req 'close' handler
          while (!isClaimed(task.id) && !clientGone) {
            const st = agentStatus(owner)
            if (st.mode === 'offline' || Date.now() - waitStart > HARD_WAIT_MS) break
            if (st.mode === 'idle' && st.nextPollInSec != null && Date.now() >= nextEmit) {
              emit({ k: 'wait', text: WAIT_TEXT, sec: st.nextPollInSec })
              nextEmit = Date.now() + WAIT_EMIT_EVERY_MS
            }
            await delay(200)
          }
        }

        if (isClaimed(task.id)) {
          emit({ k: 'think', text: '🧠 CEO denkt …' })
          let pi = 0
          const streamDeadline = Date.now() + MAX_STREAM_MS
          for (;;) {
            if (clientGone) break
            const t = getTask(task.id)
            if (t) {
              while (pi < t.progress.length) emit({ k: 'think', text: t.progress[pi++] })
              if (t.state === 'completed') {
                for (const tok of tokenize(t.answer)) { if (clientGone) break; emit({ k: 'tok', t: tok }); await delay(18) }
                break
              }
              if (t.state === 'failed') { emit({ k: 'tok', t: t.answer || '_(Agent-Fehler.)_' }); break }
            }
            if (Date.now() > streamDeadline) break
            await delay(40)
          }
        }
        else if (!clientGone) {
          emit({ k: 'offline', text: OFFLINE_TEXT })
        }
        if (!clientGone) {
          try { controller.enqueue(encoder.encode('data: [DONE]\n\n')) }
          catch { /* closed */ }
        }
      }
      finally {
        cleanup(task.id)
        try { controller.close() }
        catch { /* closed */ }
      }
    },
  })
})
