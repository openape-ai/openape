// Step 2 of the agent-lifecycle test: spawn → run → destroy an agent through the
// local troop, reusing the owner session saved by bind.mjs. The agent's LLM is
// the mock, so a "run" produces a traceable [mock-llm] reply.
//
// Endpoint shapes (verified against apps/openape-troop/server/api/agents):
//   POST /api/agents/spawn-intent           → { intent_id, host_id, … }
//   GET  /api/agents/spawn-intent/:id        → { pending } | { pending:false, ok, agent_email, error }
//   POST /api/agents/:name/chat/messages     → the stored human message
//   GET  /api/agents/:name/chat              → { chat, messages:[…] }
//   POST /api/agents/destroy-intent          → { intent_id, … }
//   GET  /api/agents/destroy-intent/:id      → { pending } | { pending:false, ok, error }

import { mkdirSync } from 'node:fs'
import { chromium } from 'playwright'

const OUT = '/demo/out'
mkdirSync(OUT, { recursive: true })
const TROOP = 'https://troop.openape.test'
const HOST_ID = process.env.HOST_ID || 'local-nest'
const NAME = 'testbot'

const browser = await chromium.launch({ args: ['--ignore-certificate-errors'] })
const context = await browser.newContext({ ignoreHTTPSErrors: true, storageState: '/out/troop-state.json', viewport: { width: 1280, height: 860 } })
const api = context.request
const page = await context.newPage()

let step = 0
async function shot(name) {
  step++
  await page.screenshot({ path: `${OUT}/agent-${String(step).padStart(2, '0')}-${name}.png` }).catch(() => {})
  console.log(`[shot] agent-${String(step).padStart(2, '0')}-${name}`)
}
// Poll an intent endpoint until the nest reports a result ({pending:false}).
async function pollIntent(path, tries = 90) {
  for (let i = 0; i < tries; i++) {
    const r = await api.get(`${TROOP}${path}`)
    const b = await r.json().catch(() => ({}))
    if (b && b.pending === false) return b
    await new Promise(s => setTimeout(s, 1000))
  }
  return undefined
}

// ---- SPAWN ----
console.log('=== SPAWN ===')
let r = await api.post(`${TROOP}/api/agents/spawn-intent`, {
  headers: { 'content-type': 'application/json' },
  data: { name: NAME, host_id: HOST_ID, bridge_base_url: 'http://mock-llm:4000/v1', bridge_model: 'gpt-5.5', bridge_key: 'sk-mock', system_prompt: 'You are a test agent. Reply briefly.' },
})
let b = await r.json().catch(() => ({}))
console.log(`spawn-intent → ${r.status()} ${JSON.stringify(b).slice(0, 240)}`)
const spawnId = b.intent_id
if (!spawnId) throw new Error(`no intent_id (status ${r.status()})`)
const spawnRes = await pollIntent(`/api/agents/spawn-intent/${spawnId}`)
console.log(`spawn-result → ${JSON.stringify(spawnRes)}`)
if (!spawnRes?.ok) throw new Error(`spawn failed: ${JSON.stringify(spawnRes)}`)
await page.goto(`${TROOP}/agents`, { waitUntil: 'networkidle' }).catch(() => {})
await page.waitForTimeout(2500)
await shot('spawned')

// ---- RUN ----
// The bridge subscribes to the chat a few seconds after spawn (on its troop WS
// open), and troop only broadcasts LIVE messages — it doesn't replay history.
// So a message sent before the bridge subscribed is lost to it. Re-send across
// a ~60s window until the mock-llm reply lands.
console.log('=== RUN ===')
async function findReply() {
  const cr = await api.get(`${TROOP}/api/agents/${NAME}/chat`)
  const chat = await cr.json().catch(() => ({}))
  const msgs = Array.isArray(chat?.messages) ? chat.messages : []
  return [...msgs].reverse().find(m => m?.role && m.role !== 'human' && (m.body || '').includes('mock-llm'))
}
let reply
for (let attempt = 1; attempt <= 4 && !reply; attempt++) {
  r = await api.post(`${TROOP}/api/agents/${NAME}/chat/messages`, { headers: { 'content-type': 'application/json' }, data: { body: `Say hello for the lifecycle test (attempt ${attempt}).` } })
  console.log(`send #${attempt} → ${r.status()}`)
  for (let i = 0; i < 15 && !reply; i++) {
    await new Promise(s => setTimeout(s, 1000))
    reply = await findReply()
  }
}
console.log(`agent reply → ${reply ? JSON.stringify(reply.body).slice(0, 180) : 'NONE (no [mock-llm] message seen)'}`)
await page.goto(`${TROOP}/agents/${NAME}`, { waitUntil: 'networkidle' }).catch(() => {})
await page.waitForTimeout(2000)
await shot('ran')
if (!reply) console.log('⚠ RUN produced no agent reply — bridge may not have connected (check nest logs).')

// ---- DESTROY ----
// KEEP=1 leaves the agent running so its bridge logs can be inspected when a
// run fails (destroy wipes the agent home + its pm2 logs).
if (process.env.KEEP === '1') {
  console.log('=== DESTROY skipped (KEEP=1) ===')
}
else {
  console.log('=== DESTROY ===')
  // The nest's `apes agents destroy` de-registers the agent at the IdP, whose
  // per-IP auth cap (10/min) the spawn already drew down on this same nest IP.
  // De-register can therefore 429; the window drains in seconds, so retry.
  let destroyRes
  for (let attempt = 1; attempt <= 4; attempt++) {
    r = await api.post(`${TROOP}/api/agents/destroy-intent`, { headers: { 'content-type': 'application/json' }, data: { name: NAME, host_id: HOST_ID } })
    b = await r.json().catch(() => ({}))
    console.log(`destroy-intent #${attempt} → ${r.status()} ${JSON.stringify(b).slice(0, 120)}`)
    if (!b.intent_id) break
    destroyRes = await pollIntent(`/api/agents/destroy-intent/${b.intent_id}`)
    console.log(`destroy-result #${attempt} → ${JSON.stringify(destroyRes)}`)
    if (destroyRes?.ok) break
    if (!/rate limit|429|too many/i.test(destroyRes?.error || '')) break
    console.log('  rate-limited — waiting 12s for the auth window to drain…')
    await new Promise(s => setTimeout(s, 12000))
  }
  if (!destroyRes?.ok) console.log('⚠ DESTROY did not confirm ok — see result above.')
  await page.goto(`${TROOP}/agents`, { waitUntil: 'networkidle' }).catch(() => {})
  await page.waitForTimeout(2500)
  await shot('destroyed')
}

console.log('=== lifecycle done ===')
await browser.close()
