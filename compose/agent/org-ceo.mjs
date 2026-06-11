// Org guide capture — "Add a CEO to your org". The org guide lives here (not
// in the demo run) because its final story spawns a real CEO agent, which
// needs a bound nest (compose/agent/run.sh). Reuses the demo org stories
// (sign-in + create-org) verbatim, then adds the cross-SP delegation spawn as
// a third story. Each step's caption becomes the /docs guide text.

import { mkdirSync } from 'node:fs'
import process from 'node:process'
import { chromium } from 'playwright'
import { createStoryKit } from '/demo/src/story-kit.mjs'
import orgStories from '/demo/src/stories/org.mjs'

const OUT = '/demo/out'
mkdirSync(OUT, { recursive: true })
const ORG = 'https://org.openape.test'
const IDP = 'https://id.openape.test'
const EMAIL = 'demo@openape.test'

const browser = await chromium.launch({ args: ['--ignore-certificate-errors'] })
const context = await browser.newContext({ ignoreHTTPSErrors: true, storageState: '/out/troop-state.json', viewport: { width: 1280, height: 860 } })
const page = await context.newPage()
// NB: no installDeterminism here — this story spawns a real agent (random
// identity suffix, live timestamps) so it can't be byte-identical anyway, and
// a frozen clock breaks @nuxt/ui's popover open animation (the role select).
page.on('console', m => { if (m.type() === 'error') console.log(`[org-ceo console.error] ${m.text()}`) })

const kit = createStoryKit({ outDir: OUT, page })
const ctx = { kit, page, EMAIL, ORG, IDP }

// Sign-in + create-org (the demo org guide), then the CEO spawn on top.
await orgStories(ctx)

await kit.story({
  app: 'openape-org',
  category: 'Organizations',
  id: 'add-ceo',
  title: 'Add a CEO to your org',
  intro: 'Your org\'s first hire is a CEO — an agent spawned from a pinned recipe and bound to this org. You approve a one-time delegation at your IdP; from then on the CEO runs on your own nest under your account, reading your vision and proposing objectives.',
}, async (s) => {
  await s.step('Add the CEO seat', {
    do: async () => {
      await page.getByRole('button', { name: /add member/i }).first().click()
      await page.waitForTimeout(900)
      const dialog = page.getByRole('dialog').first()
      // Open the Role USelect (a button showing "Specialist") and pick CEO.
      // Options render in a portal as role=option — wait for it before clicking.
      await dialog.locator('button:has-text("Specialist")').first().click()
      const ceoOpt = page.getByRole('option', { name: 'CEO' })
      await ceoOpt.waitFor({ state: 'visible', timeout: 5000 })
      await ceoOpt.click()
      await page.waitForTimeout(500)
      await dialog.locator('input[placeholder="alice"]').first().fill('Ada').catch(async () => {
        await dialog.locator('input[type=text], input:not([type])').first().fill('Ada')
      })
      await page.waitForTimeout(400)
    },
    shot: 'add-ceo',
  }, 'Open **Add member**, choose the **CEO** role and name it. Leave the email blank — the org creates a placeholder seat you fill by spawning. (CEO + Sanierer sit at the top of the chart; the Sanierer keeps the CEO honest about cost.)')

  await s.step('Approve the one-time delegation', {
    do: async () => {
      const dialog = page.getByRole('dialog').first()
      await dialog.getByRole('button', { name: /^\s*(add|hinzufügen|save|speichern)\s*$/i }).last().click()
      await page.waitForTimeout(1500)
      await page.getByRole('button', { name: /spawn agent/i }).first().click()
      await page.waitForURL(/grant-cross-sp/, { timeout: 20000 }).catch(() => {})
      await page.waitForTimeout(2500)
    },
    shot: 'consent',
  }, 'Spawning asks your consent **once**. The IdP shows exactly what org may do on your behalf — *spawn agents on your troop* — as a standing, revocable grant. This is a top-level redirect to your IdP; org never sees your IdP session. Approve it.')

  await s.step('The CEO is live', {
    do: async () => {
      await page.getByRole('button', { name: /^approve$/i }).first().click().catch(() => {})
      await page.waitForURL(/org\.openape\.test\/orgs\//, { timeout: 30000 }).catch(() => {})
      // Poll until the placeholder flips to the live agent.
      for (let i = 0; i < 60; i++) {
        await page.waitForTimeout(2000)
        const active = await page.evaluate(async () => {
          const id = location.pathname.split('/').pop()
          const r = await fetch(`/api/orgs/${id}/members`, { credentials: 'include' })
          const b = await r.json().catch(() => [])
          const list = Array.isArray(b) ? b : (b.members ?? [])
          return list.some(m => m.role === 'ceo' && m.status === 'active')
        }).catch(() => false)
        if (active) break
      }
      await page.reload({ waitUntil: 'networkidle' }).catch(() => {})
      await page.waitForTimeout(1500)
    },
    shot: 'active',
  }, 'Within seconds the CEO is **active** on your nest, with its own `…@id.openape.ai` identity. It reads your vision live and starts proposing objectives — and you can revoke the delegation at your IdP any time to cut it off.')
})

await kit.story({
  app: 'openape-org',
  category: 'Organizations',
  id: 'revoke-delegation',
  title: 'Revoke a delegation',
  intro: 'When you spawned the CEO you approved a standing delegation — org may spawn agents on your troop on your behalf. It\'s revocable any time, and the moment you revoke it the next spawn that service attempts is refused.',
}, async (s) => {
  await s.step('Find your delegations in Settings', {
    do: async () => {
      await page.getByRole('tab', { name: /settings/i }).first().click().catch(() => {})
      await page.waitForTimeout(800)
      const card = page.getByText(/^\s*delegations\s*$/i).first()
      await card.scrollIntoViewIfNeeded({ timeout: 3000 }).catch(() => {})
      await page.waitForTimeout(500)
    },
    shot: 'settings-card',
  }, 'In your org\'s **Settings** there\'s a **Delegations** card. The delegations live at your IdP — the single place that knows everything acting on your behalf — so org just links you there.')

  await s.step('See what\'s acting on your behalf', {
    do: async () => {
      await page.goto(`${IDP}/delegations`, { waitUntil: 'networkidle' }).catch(() => {})
      await page.waitForTimeout(2500)
    },
    shot: 'delegations-list',
  }, 'Your IdP lists every standing delegation: here **org.openape.ai** may act for you at **troop.openape.ai** with exactly the `troop:spawn-agent` permission you approved — nothing more.')

  await s.step('Revoke it', {
    do: async () => {
      await page.getByRole('button', { name: /^revoke$/i }).first().click().catch(() => {})
      await page.waitForTimeout(500)
      await page.getByRole('button', { name: /confirm revoke/i }).first().click().catch(() => {})
      await page.waitForTimeout(2500)
    },
    shot: 'revoked',
  }, 'One click and a confirm. The grant is gone — the org can no longer spawn on your troop, and troop refuses any token minted from it. Spawning again would prompt a fresh consent.')
})

const failures = kit.finish('org')
console.log('=== org-ceo done ===')
await browser.close()
process.exit(failures > 0 ? 1 : 0)
