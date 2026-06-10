// OpenApe Org user stories.
import { approveIfPrompted, click, fillEmail } from '../story-kit.mjs'

export default async function run({ kit, page, EMAIL, ORG }) {
  await kit.story({
    app: 'openape-org',
    category: 'Getting started',
    id: 'sign-in',
    title: 'Sign in',
    intro: 'Org runs your CEO-led agent organizations. Like every OpenApe app it signs you in via DDISA SSO — same passkey, same IdP.',
  }, async (s) => {
    await s.step('Open Org', {
      do: () => page.goto(ORG, { waitUntil: 'networkidle' }),
      shot: 'landing',
    }, 'The start page is the sign-in: enter your email and continue.')

    await s.step('Signed in — your organizations', {
      do: async () => {
        await fillEmail(page, EMAIL)
        await click(page, /continue|weiter|sign in with openape|sign in|login|anmelden/i)
        await page.waitForTimeout(2500)
        await approveIfPrompted(page)
        await page.waitForURL(/org\.openape\.test/, { timeout: 20000 }).catch(() => {})
        await page.waitForTimeout(2500)
      },
      shot: 'home-empty',
    }, 'On first visit the list is empty — each org you create is a virtual company with its own CEO, team, budget and reports.')
  })

  await kit.story({
    app: 'openape-org',
    category: 'Organizations',
    id: 'create-org',
    title: 'Create your first org',
    intro: 'An org starts with three things: a name, a vision the CEO will read, and a monthly budget cap the Sanierer enforces.',
  }, async (s) => {
    await s.step('Start a new organization', {
      do: async () => {
        await page.goto(ORG, { waitUntil: 'networkidle' })
        await page.waitForTimeout(1500)
        await click(page, /create your first org|new org/i)
        await page.waitForTimeout(800)
      },
      shot: 'dialog',
    }, 'Click **Create your first org**. The dialog asks for the basics — you can refine the vision and grow the team later.')

    await s.step('Name, vision, budget', {
      do: async () => {
        await page.getByPlaceholder(/openape inc/i).fill('Demo GmbH')
        await page.locator('textarea').first().fill('Ship the demo: a tiny virtual company that proves the flow end-to-end.')
        await page.locator('input[type=number]').first().fill('100')
      },
      shot: 'filled',
    }, 'The vision is plain prose — the CEO reads it. The monthly budget is the hard cap: above it, the Sanierer stops the CEO from hiring more.')

    await s.step('Create', {
      do: async () => {
        await click(page, /^\s*create\s*$/i)
        await page.waitForURL(/\/orgs\//, { timeout: 15000 }).catch(() => {})
        await page.waitForTimeout(2000)
      },
      shot: 'org-page',
    }, 'The org page opens: org chart, members, cost dashboard and reports — empty for now, ready for a CEO.')
  })
}
