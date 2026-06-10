// Agent-lifecycle user stories: spawn → chat → inspect → destroy an agent
// through the local troop, reusing the owner session saved by bind.mjs. The
// agent's LLM is the mock, so a "run" produces a traceable [mock-llm] reply.
// Each story is a real test AND the source of the troop /docs guide content
// (see compose/demo/story-kit.mjs).
//
// Endpoint shapes (verified against apps/openape-troop/server/api/agents):
//   POST /api/agents/spawn-intent           → { intent_id, host_id, … }
//   GET  /api/agents/spawn-intent/:id        → { pending } | { pending:false, ok, agent_email, error }
//   POST /api/agents/:name/chat/messages     → the stored human message
//   GET  /api/agents/:name/chat              → { chat, messages:[…] }
//   POST /api/agents/destroy-intent          → { intent_id, … }
//   GET  /api/agents/destroy-intent/:id      → { pending } | { pending:false, ok, error }

import { mkdirSync } from 'node:fs'
import process from 'node:process'
import { chromium } from 'playwright'
import { createStoryKit } from '/demo/src/story-kit.mjs'

const OUT = '/demo/out'
mkdirSync(OUT, { recursive: true })
const TROOP = 'https://troop.openape.test'
const IDP = 'https://id.openape.test'
const HOST_ID = process.env.HOST_ID || 'local-nest'
const NAME = 'testbot'

const browser = await chromium.launch({ args: ['--ignore-certificate-errors'] })
const context = await browser.newContext({ ignoreHTTPSErrors: true, storageState: '/out/troop-state.json', viewport: { width: 1280, height: 860 } })
const api = context.request
const page = await context.newPage()
const kit = createStoryKit({ outDir: OUT, page })

// Poll an intent endpoint until the nest reports a result ({pending:false}).
async function pollIntent(path, tries = 90) {
  for (let i = 0; i < tries; i++) {
    const r = await api.get(`${TROOP}${path}`)
    const b = await r.json().catch(() => ({}))
    if (b && b.pending === false)
      return b
    await new Promise(s => setTimeout(s, 1000))
  }
  return undefined
}

await kit.story({
  app: 'openape-troop',
  category: 'Agents',
  id: 'spawn-agent',
  title: 'Spawn your first agent',
  intro: 'Agents run on YOUR machine: a local nest daemon is bound to Troop and receives spawn intents over a websocket. Spawning creates a real OS user, an agent identity at your IdP, and a chat bridge.',
}, async (s) => {
  await s.step('Send the spawn intent', {
    do: async () => {
      const r = await api.post(`${TROOP}/api/agents/spawn-intent`, {
        headers: { 'content-type': 'application/json' },
        data: { name: NAME, host_id: HOST_ID, bridge_base_url: 'http://mock-llm:4000/v1', bridge_model: 'gpt-5.5', bridge_key: 'sk-mock', system_prompt: 'You are a test agent. Reply briefly.' },
      })
      const b = await r.json().catch(() => ({}))
      if (!b.intent_id)
        throw new Error(`no intent_id (status ${r.status()})`)
      const res = await pollIntent(`/api/agents/spawn-intent/${b.intent_id}`)
      if (!res?.ok)
        throw new Error(`spawn failed: ${JSON.stringify(res)}`)
    },
  }, 'Use **Spawn agent** in the dashboard (or `apes agents spawn <name>` on the nest machine): pick a name, a model, and a system prompt. Troop forwards the intent to your nest, which provisions the agent.')

  await s.step('The agent appears', {
    do: async () => {
      await page.goto(`${TROOP}/agents`, { waitUntil: 'networkidle' }).catch(() => {})
      await page.waitForTimeout(2500)
    },
    shot: 'spawned',
  }, 'Within seconds the agent shows up in **My Agents** — it now has its own identity at your IdP (`<name>-…@id.openape.ai`) and is reachable from every OpenApe app.')
})

await kit.story({
  app: 'openape-troop',
  category: 'Agents',
  id: 'chat-with-agent',
  title: 'Chat with your agent',
  intro: 'Every agent has a chat. A reply proves the whole path end-to-end: Troop → nest → bridge → LLM → back.',
}, async (s) => {
  // The bridge subscribes to the chat a few seconds after spawn (on its troop
  // WS open), and troop only broadcasts LIVE messages — it doesn't replay
  // history. So re-send across a ~60s window until the reply lands.
  let reply
  await s.step('Send a message', {
    do: async () => {
      async function findReply() {
        const cr = await api.get(`${TROOP}/api/agents/${NAME}/chat`)
        const chat = await cr.json().catch(() => ({}))
        const msgs = Array.isArray(chat?.messages) ? chat.messages : []
        return [...msgs].reverse().find(m => m?.role && m.role !== 'human' && (m.body || '').includes('mock-llm'))
      }
      for (let attempt = 1; attempt <= 4 && !reply; attempt++) {
        await api.post(`${TROOP}/api/agents/${NAME}/chat/messages`, { headers: { 'content-type': 'application/json' }, data: { body: `Say hello for the lifecycle test (attempt ${attempt}).` } })
        for (let i = 0; i < 15 && !reply; i++) {
          await new Promise(s2 => setTimeout(s2, 1000))
          reply = await findReply()
        }
      }
      if (!reply)
        throw new Error('no agent reply — bridge may not have connected (check nest logs)')
    },
  }, 'Open the agent and type a message. The bridge picks it up over the websocket and runs your configured LLM.')

  await s.step('The agent replies', {
    do: async () => {
      await page.goto(`${TROOP}/agents/${NAME}`, { waitUntil: 'networkidle' }).catch(() => {})
      await page.waitForTimeout(2000)
    },
    shot: 'reply',
  }, 'The reply lands in the chat — in this E2E run it is tagged `[mock-llm]`, proving spawn → bridge → LLM → reply without touching a paid model.')
})

await kit.story({
  app: 'openape-troop',
  category: 'Agents',
  id: 'inspect-agent',
  title: 'Inspect & configure an agent',
  intro: 'The agent page is also its control panel: system prompt, schedule, tools and run history live next to the chat.',
}, async (s) => {
  await s.step('Open the agent page', {
    do: async () => {
      await page.goto(`${TROOP}/agents/${NAME}`, { waitUntil: 'networkidle' }).catch(() => {})
      await page.waitForTimeout(1500)
      // Bring the configuration area into view if present.
      const cfg = page.getByText(/system prompt|cron|schedule|tools/i).first()
      await cfg.scrollIntoViewIfNeeded({ timeout: 3000 }).catch(() => {})
      await page.waitForTimeout(800)
    },
    shot: 'detail',
  }, 'Edit the system prompt, set a cron schedule for recurring runs, pick tools, or wire a recipe — changes sync to the nest live over the websocket.')
})

// The spawned agent also exists as an identity at the IdP — capture that view
// if this context still holds an IdP session (bind.mjs created it).
const me = await api.get(`${IDP}/api/me`).catch(() => null)
if (me && me.ok()) {
  await kit.story({
    app: 'openape-free-idp',
    category: 'Agents',
    id: 'agent-identities',
    title: 'Your agent identities',
    intro: 'Agents are first-class identities under your account: the IdP mints them a DDISA email and you stay in control.',
  }, async (s) => {
    await s.step('Open Agents at your IdP', {
      do: async () => {
        await page.goto(`${IDP}/agents`, { waitUntil: 'networkidle' }).catch(() => {})
        await page.waitForTimeout(2000)
      },
      shot: 'agents',
    }, 'Every agent spawned from your nests appears here with its own `…@id.openape.ai` identity — inspect it, or revoke it independently of your own keys.')
  })
}
else {
  console.log('[skip] idp agent-identities story — no IdP session in this context')
}

if (process.env.KEEP === '1') {
  console.log('=== DESTROY skipped (KEEP=1) ===')
}
else {
  await kit.story({
    app: 'openape-troop',
    category: 'Agents',
    id: 'destroy-agent',
    title: 'Destroy an agent',
    intro: 'Tearing an agent down removes the OS user on the nest and de-registers its identity at the IdP — no zombie credentials.',
  }, async (s) => {
    await s.step('Destroy it', {
      do: async () => {
        // The nest's `apes agents destroy` de-registers the agent at the IdP,
        // whose per-IP auth cap the spawn already drew down — retry on 429.
        let res
        for (let attempt = 1; attempt <= 4; attempt++) {
          const r = await api.post(`${TROOP}/api/agents/destroy-intent`, { headers: { 'content-type': 'application/json' }, data: { name: NAME, host_id: HOST_ID } })
          const b = await r.json().catch(() => ({}))
          if (!b.intent_id)
            break
          res = await pollIntent(`/api/agents/destroy-intent/${b.intent_id}`)
          if (res?.ok)
            break
          if (!/rate limit|429|too many/i.test(res?.error || ''))
            break
          console.log('  rate-limited — waiting 12s for the auth window to drain…')
          await new Promise(s2 => setTimeout(s2, 12000))
        }
        if (!res?.ok)
          throw new Error(`destroy did not confirm ok: ${JSON.stringify(res)}`)
      },
    }, 'Hit **Destroy** on the agent (or `apes agents destroy <name>`). The nest wipes the agent home and the IdP drops its identity.')

    await s.step('Gone', {
      do: async () => {
        await page.goto(`${TROOP}/agents`, { waitUntil: 'networkidle' }).catch(() => {})
        await page.waitForTimeout(2500)
      },
      shot: 'gone',
    }, 'The dashboard is empty again — spawn → run → destroy, fully reversible.')
  })
}

const failures = kit.finish('agent')
console.log('=== lifecycle done ===')
await browser.close()
process.exit(failures > 0 ? 1 : 0)
