import { and, eq } from 'drizzle-orm'
import { useDb } from '../../database/drizzle'
import { objectives, organizations } from '../../database/schema'
import { cockpitOwner } from '../../utils/cockpit/auth'
import { abort, agentRecentlyActive, cleanup, enqueue, getTask, isClaimed } from '../../utils/cockpit/queue'
import { streamMock, tokenize } from '../../utils/cockpit/mock-brain'

const CLAIM_TIMEOUT_MS = 3500
const MAX_STREAM_MS = 120000
const delay = (ms: number) => new Promise(r => setTimeout(r, ms))

interface Org { name: string; visionMd: string; budgetMonthlyEur: number }
interface Objective { title: string; status: string }

function buildSystemPrompt(org: Org, objs: Objective[], owner: string): string {
  let p = `Du bist die CEO der Firma „${org.name}". Antworte als diese CEO: knapp, konkret, auf Deutsch. Erfinde keine ausgeführten Aktionen. Du sprichst gerade direkt mit deinem Owner (${owner}) — sprich ihn persönlich an.`
  if (org.visionMd) p += `\n\nVision/Kontext (aus dem Control-Plane):\n${org.visionMd}`
  if (objs.length) p += `\n\nAktuelle Ziele:\n${objs.map(o => `- ${o.title} (${o.status})`).join('\n')}`
  if (org.budgetMonthlyEur) p += `\n\nMonatsbudget: ${org.budgetMonthlyEur} €.`
  return p
}

export default defineEventHandler(async (event) => {
  const owner = await cockpitOwner(event)
  const body = await readBody<{ company?: string; messages?: { role: string; content: string }[] }>(event)
  const company = body?.company ?? ''
  const db = useDb()
  const [org] = await db.select().from(organizations).where(and(eq(organizations.id, company), eq(organizations.ownerEmail, owner)))
  if (!org) throw createError({ statusCode: 404, statusMessage: 'unknown company' })
  const objs = await db.select().from(objectives).where(eq(objectives.orgId, company))

  const userMessage = [...(body?.messages ?? [])].reverse().find(m => m.role === 'user')?.content ?? ''
  const task = enqueue(company, buildSystemPrompt(org, objs, owner), userMessage, owner)

  setResponseHeaders(event, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
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
        const brainLive = agentRecentlyActive()
        if (brainLive) emit({ k: 'think', text: '🧠 Dein CEO übernimmt …' })
        const claimDeadline = Date.now() + (brainLive ? 20000 : CLAIM_TIMEOUT_MS)
        // eslint-disable-next-line no-unmodified-loop-condition -- clientGone is flipped by the req 'close' handler
        while (!isClaimed(task.id) && Date.now() < claimDeadline && !clientGone) await delay(60)

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
          await streamMock(body?.messages ?? [], emit, () => clientGone)
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
