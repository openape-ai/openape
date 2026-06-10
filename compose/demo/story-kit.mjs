// Story kit: user-story guides generated FROM E2E tests. A story is a real
// Playwright test whose steps carry the guide text — if the test fails there
// is no guide entry, so docs cannot drift from the product.
//
// Usage (in a runner):
//   const kit = createStoryKit({ outDir: '/demo/out' })
//   await kit.story({ app, category, id, title, intro }, async (s) => {
//     await s.step('Open the dashboard', { shot: 'dashboard' },
//       'After signing in you land on …')
//     await s.step('Do something', { do: () => click(page, /…/), shot: 'done' },
//       'Click … — the result appears within seconds.')
//   })
//   kit.finish('demo')  // writes <outDir>/manifest-<label>.json, returns #fails
//
// Screenshots land at <outDir>/screenshots/<app>/<story>/<NN>-<shot>.png — no
// global numbering, adding stories never renumbers anything.

import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export function createStoryKit({ outDir, page }) {
  const stories = []
  const failures = []
  let order = 0

  async function story(meta, fn) {
    order += 1
    const rec = { ...meta, order, steps: [] }
    let stepNo = 0
    const s = {
      page,
      async step(title, opts = {}, caption = '') {
        stepNo += 1
        if (opts.do)
          await opts.do()
        let shot = null
        if (opts.shot) {
          const dir = join(outDir, 'screenshots', meta.app, meta.id)
          mkdirSync(dir, { recursive: true })
          const file = `${String(stepNo).padStart(2, '0')}-${opts.shot}.png`
          await page.waitForTimeout(opts.settle ?? 600)
          await page.screenshot({ path: join(dir, file) })
          shot = `${meta.id}/${file}`
        }
        rec.steps.push({ title, caption, shot })
        console.log(`  [${meta.app}/${meta.id} ${String(stepNo).padStart(2, '0')}] ${title}`)
      },
    }
    console.log(`\n=== story ${meta.app}/${meta.id} — ${meta.title} ===`)
    try {
      await fn(s)
      stories.push(rec)
    }
    catch (e) {
      failures.push({ story: `${meta.app}/${meta.id}`, error: e.message.split('\n')[0] })
      console.log(`[STORY FAIL] ${meta.app}/${meta.id}: ${e.message.split('\n')[0]}`)
      const dir = join(outDir, 'screenshots', meta.app, meta.id)
      mkdirSync(dir, { recursive: true })
      await page.screenshot({ path: join(dir, 'FAIL.png') }).catch(() => {})
    }
  }

  function finish(label) {
    writeFileSync(join(outDir, `manifest-${label}.json`), `${JSON.stringify({ stories }, null, 2)}\n`)
    console.log(`\n[stories] ${stories.length} ok, ${failures.length} failed → manifest-${label}.json`)
    for (const f of failures)
      console.log(`  ✗ ${f.story}: ${f.error}`)
    return failures.length
  }

  return { story, finish }
}

// --- shared page helpers (ported from the old flow runner) ---

export async function click(page, re, { timeout = 12000, optional = false } = {}) {
  const el = page.getByRole('button', { name: re }).or(page.getByRole('link', { name: re })).first()
  try {
    await el.waitFor({ state: 'visible', timeout })
    await el.click()
    return true
  }
  catch (e) {
    if (optional)
      return false
    throw e
  }
}

export async function fillEmail(page, email, { optional = false } = {}) {
  const input = page.locator('input[type=email], input[placeholder*="@"]').first()
  try {
    await input.waitFor({ state: 'visible', timeout: 10000 })
    await input.fill(email)
    return true
  }
  catch (e) {
    if (optional)
      return false
    throw e
  }
}

// After an SP redirect the browser may pass through the IdP's /login (passkey
// assertion) and/or /consent pages before bouncing back. Walk up to a few
// hops: on /login click "Sign in with Passkey" (the virtual authenticator
// answers), on /consent approve.
export async function approveIfPrompted(page) {
  for (let hop = 0; hop < 4; hop++) {
    await page.waitForLoadState('networkidle').catch(() => {})
    await page.waitForTimeout(1300)
    const url = page.url()
    let did = false
    if (/\/login/.test(url))
      did = await click(page, /sign in with passkey/i, { optional: true, timeout: 8000 })
    else if (/\/consent|\/authorize/.test(url))
      did = await click(page, /^\s*anmelden\s*$|authorize|approve|zustimmen|bestätigen|erlauben/i, { optional: true, timeout: 8000 })
    else break
    console.log(`[approve hop ${hop}] ${url.slice(0, 60)} → clicked=${did}`)
    if (!did)
      break
    await page.waitForTimeout(1500)
  }
}

// Sign into an SP from its start page (email → continue → passkey/consent).
export async function ssoInto(page, baseUrl, email) {
  await page.goto(baseUrl, { waitUntil: 'networkidle' })
  await fillEmail(page, email)
  await click(page, /continue|weiter|sign in with openape|sign in|login|anmelden/i)
  await page.waitForTimeout(2000)
  await approveIfPrompted(page)
  await page.waitForURL(u => u.origin === new URL(baseUrl).origin, { timeout: 20000 }).catch(() => {})
  await page.waitForTimeout(2000)
}

// Make screenshots byte-deterministic across runs (no code change ⇒ no PNG
// diff ⇒ a PNG diff in a PR means a real UI change). Two client-side levers:
//   - SEED Math.random (LCG) so any UI randomness (e.g. the spawn dialog's
//     placeholder name) is the same every run. Seeded, NOT constant: reka-ui
//     keys its body-scroll-lock map with Math.random(), so a constant makes
//     the spawn dialog and its recipe <USelect> collide on one key and the
//     listbox never opens. The LCG keeps values unique within a run but
//     identical across runs.
//   - pin the wall clock (Date.now / argless new Date) to a fixed instant
//     that advances ONE millisecond per Date.now() call, so client-rendered
//     "now"/relative times are stable. Strictly monotonic, never frozen:
//     Vue's runtime-dom stamps DOM events with Date.now() (`e._vts`) and
//     skips handlers when the stamp is <= the handler's attach time — a
//     hard-frozen clock makes every bubbling Vue handler after the first
//     silently no-op (the spawn dialog's recipe <USelect> never opened).
//     Playwright's clock API (`clock.setFixedTime` included) freezes hard
//     and hits exactly that, so we shim Date ourselves.
// Server-stamped values (a chat message's own timestamp) are data, not client
// clock, and stay as captured — those views avoid showing volatile absolute
// times, or accept that data drives them.
export async function installDeterminism(page) {
  await page.addInitScript(() => {
    let seed = 42
    Math.random = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0
      return seed / 4294967296
    }
    const FIXED = 1780304400000 // 2026-06-01T09:00:00Z
    let tick = 0
    const RealDate = Date
    // eslint-disable-next-line no-global-assign
    Date = class extends RealDate {
      constructor(...args) {
        if (args.length === 0)
          super(FIXED + tick)
        else
          super(...args)
      }

      static now() {
        tick += 1
        return FIXED + tick
      }
    }
  })
}
