import { cockpitOwner } from '../../utils/cockpit/auth'
import { buildOrgSystemPrompt } from '../../utils/cockpit/org-context'
import { saveChatMessage } from '../../utils/cockpit/chat-store'
import { agentStatus, cleanup, enqueue, getTask, isClaimed, isTerminal } from '../../utils/cockpit/queue'
import { saveTask } from '../../utils/cockpit/task-store'

const HARD_WAIT_MS = 180000 // give a present-but-idle brain this long to claim before we call it offline
const WAIT_EMIT_EVERY_MS = 3000 // refresh the Ruhemodus countdown this often
const MAX_STREAM_MS = 240000
const WAIT_TEXT = '💤 Operator im Ruhemodus'
const OFFLINE_TEXT = '💤 Deine Nachricht ist aufgenommen — der Operator beantwortet sie, sobald er wieder da ist. Beim nächsten Öffnen ist die Antwort da.'
const delay = (ms: number) => new Promise(r => setTimeout(r, ms))

// Split into word-sized tokens, keeping trailing whitespace/newlines intact.
const tokenize = (text: string): string[] => text.match(/\S+\s*|\s+/g) ?? [text]

export default defineEventHandler(async (event) => {
  const owner = await cockpitOwner(event)
  const body = await readBody<{ company?: string, messages?: { role: string, content: string }[] }>(event)
  const company = body?.company ?? ''
  const systemPrompt = await buildOrgSystemPrompt(owner, company)
  if (systemPrompt == null) throw createError({ statusCode: 404, statusMessage: 'unknown company' })

  const history = body?.messages ?? []
  const latestUser = [...history].reverse().find(m => m.role === 'user')?.content ?? ''
  if (latestUser.trim()) await saveChatMessage(company, owner, 'user', latestUser)
  // Give the Operator the recent conversation (last 20 turns) so follow-ups like
  // "bitte ablegen - ja" resolve against what was said before — not just the last line.
  const recent = history.slice(-20)
  const prompt = recent.length > 1
    ? `Bisheriger Gesprächsverlauf:\n${recent.map(m => `${m.role === 'user' ? 'Patrick' : 'Du'}: ${m.content}`).join('\n')}\n\nBeantworte die LETZTE Nachricht von Patrick im Kontext dieses Verlaufs — antworte direkt als Operator, ohne Namenspräfix.`
    : latestUser
  const task = enqueue(company, systemPrompt, prompt, owner)
  // Persist the input so a troop restart before the worker resolves doesn't drop it.
  void saveTask({ id: task.id, company, owner, systemPrompt, userMessage: prompt, createdAt: Date.now() }).catch(err => console.error('[task-store] save', err))

  setResponseHeaders(event, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache, no-transform',
    'connection': 'keep-alive',
  })

  let clientGone = false
  // Client leaving must NOT kill the task — the Operator still answers and the answer
  // is persisted; the browser reloads it later. Just stop streaming.
  event.node.req.on('close', () => { clientGone = true })
  const encoder = new TextEncoder()

  return new ReadableStream({
    async start(controller) {
      const KEEPALIVE_MS = 12000
      let lastByteAt = Date.now()
      const emit = (obj: unknown) => {
        try { controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`)); lastByteAt = Date.now() }
        catch { /* stream closed */ }
      }
      // SSE comment — keeps the connection alive through the proxy during quiet
      // stretches (a long, progress-less Operator answer). The client parser ignores it.
      const keepAlive = () => {
        try { controller.enqueue(encoder.encode(':ka\n\n')); lastByteAt = Date.now() }
        catch { /* stream closed */ }
      }
      try {
        // Hand the browser the task id first thing, so if the stream drops it can
        // re-attach to this task's live progress (GET tasks/<id>/progress).
        emit({ k: 'id', id: task.id })
        // Wait for the owner's Operator brain to claim the task. We never fake an
        // answer: if a brain is present we wait for it (showing "übernimmt" when
        // it's awake, a live "Ruhemodus" countdown when it's sleeping); only if
        // no brain is reachable do we return an honest offline notice.
        const first = agentStatus(owner)
        if (first.mode !== 'offline') {
          if (first.mode === 'idle' && first.nextPollInSec != null)
            emit({ k: 'wait', text: WAIT_TEXT, sec: first.nextPollInSec })
          else
            emit({ k: 'think', text: '🧠 Dein Operator übernimmt …' })

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
            if (Date.now() - lastByteAt >= KEEPALIVE_MS) keepAlive()
            await delay(200)
          }
        }

        if (isClaimed(task.id)) {
          emit({ k: 'think', text: '🧠 Operator denkt …' })
          let pi = 0
          let answered = false
          const streamDeadline = Date.now() + MAX_STREAM_MS
          for (;;) {
            if (clientGone) break
            const t = getTask(task.id)
            if (t) {
              while (pi < t.progress.length) emit({ k: 'think', text: t.progress[pi++] })
              if (t.state === 'completed') {
                const ans = (t.answer ?? '').trim()
                if (ans) {
                  for (const tok of tokenize(ans)) { if (clientGone) break; emit({ k: 'tok', t: tok }); await delay(18) }
                }
                else {
                  emit({ k: 'tok', t: '_(Der Operator hat keine Antwort formuliert — frag bitte nochmal.)_' })
                }
                answered = true
                break
              }
              if (t.state === 'failed') {
                emit({ k: 'tok', t: (t.answer ?? '').trim() || '_(Der Operator konnte die Aufgabe nicht abschließen.)_' })
                answered = true
                break
              }
              // Soft terminal: the agent paused on a question — hand the chips to
              // the client and end THIS stream; the task itself stays alive.
              if (t.state === 'input-required') {
                emit({ k: 'ask', text: t.question ?? '', options: t.options ?? [], taskId: t.id })
                answered = true
                break
              }
            }
            if (Date.now() > streamDeadline) break
            if (Date.now() - lastByteAt >= KEEPALIVE_MS) keepAlive()
            await delay(40)
          }
          // Never leave the bubble empty: if we timed out before a terminal state,
          // say so instead of streaming nothing (the task keeps running server-side).
          if (!answered && !clientGone) emit({ k: 'tok', t: '⏳ Dein Operator braucht dafür länger als gewöhnlich — er arbeitet weiter, frag gleich nochmal nach.' })
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
        if (isTerminal(task.id)) cleanup(task.id)
        try { controller.close() }
        catch { /* closed */ }
      }
    },
  })
})
