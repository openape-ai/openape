// Troop user stories (web flows) — the agent-lifecycle stories live in
// compose/agent/lifecycle.mjs (they need the nest + mock LLM).
import { approveIfPrompted, click, fillEmail } from '../story-kit.mjs'

export default async function run({ kit, page, EMAIL, TROOP }) {
  await kit.story({
    app: 'openape-troop',
    category: 'Getting started',
    id: 'sign-in',
    title: 'Sign in with OpenApe',
    intro: 'Troop is a DDISA Service Provider: it discovers your IdP from your email domain via a DNS TXT record and redirects you there to authorize — no password, no per-app account.',
  }, async (s) => {
    await s.step('Open Troop', {
      do: () => page.goto(TROOP, { waitUntil: 'networkidle' }),
      shot: 'landing',
    }, 'The start page has the sign-in right there: enter your email.')

    await s.step('Authorize at your IdP', {
      do: async () => {
        await fillEmail(page, EMAIL)
        await click(page, /sign in with openape|sign in|login|anmelden/i)
        await page.waitForURL(/id\.openape\.test/, { timeout: 20000 }).catch(() => {})
        await page.waitForTimeout(1500)
      },
      shot: 'consent',
    }, 'Troop redirects you to your IdP, which asks once whether Troop may use your identity. Approve — the decision is remembered.')

    await s.step('You are in', {
      do: async () => {
        await approveIfPrompted(page)
        await page.waitForURL(/troop\.openape\.test/, { timeout: 20000 }).catch(() => {})
        await page.waitForTimeout(2500)
      },
      shot: 'dashboard',
    }, 'Back on Troop, authenticated: the agents dashboard. From here you spawn, configure and talk to your agents.')
  })
}
