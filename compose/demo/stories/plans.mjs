// OpenApe Plans user story: write a living plan in a team.
//
// Plans is a DDISA Service Provider with the same team model as Tasks — sign in
// once (the IdP session is already established), make a team, then write a plan
// the whole team (and any agent over `ape-plans`) can read and update.
import { approveIfPrompted, click, fillEmail } from '../story-kit.mjs'

export default async function run({ kit, page, PLANS, EMAIL }) {
  await kit.story({
    app: 'openape-plans',
    category: 'Getting started',
    id: 'write-a-plan',
    title: 'Start a team and write a plan',
    intro: 'Plans keeps living, versioned plans a team edits together — the same document an agent reads and updates over the `ape-plans` CLI. Sign in, make a team, and write your first plan.',
  }, async (s) => {
    await s.step('Sign in with one click', {
      do: async () => {
        await page.goto(PLANS, { waitUntil: 'networkidle' })
        await fillEmail(page, EMAIL)
        await click(page, /login with openape|sign in|login|anmelden/i)
        await page.waitForTimeout(2500)
        await approveIfPrompted(page)
        await page.waitForURL(/plans\.openape\.test\/teams/, { timeout: 20000 }).catch(() => {})
        await page.waitForTimeout(2000)
      },
      shot: 'teams',
    }, 'One click and you are in — your passkey, your IdP. You land on your teams; a fresh account is ready for its first one.')

    await s.step('Create a team', {
      do: async () => {
        await page.goto(`${PLANS}/teams/new`, { waitUntil: 'networkidle' })
        await page.getByPlaceholder('Delta Mind').fill('Delta Mind')
        await click(page, /create team/i)
        await page.waitForTimeout(2500)
      },
      shot: 'team',
    }, 'A team is the shared home for its plans. Invite people or authorise an agent — everyone sees the same living documents.')

    await s.step('Write a plan', {
      do: async () => {
        await click(page, /new plan|create plan|neuer plan/i, { optional: true })
        await page.waitForTimeout(1500)
        await page.getByPlaceholder('Migrate auth to DDISA').fill('Migrate auth to DDISA')
        await click(page, /create plan|create|save|anlegen/i)
        await page.waitForTimeout(2500)
      },
      shot: 'plan',
    }, 'Give the plan a title and it opens ready to edit — Markdown body, status, and a full revision history as it evolves.')
  })
}
