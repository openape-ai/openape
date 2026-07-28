// OpenApe Tasks user story: create a shared board and add tasks.
//
// Tasks is a DDISA Service Provider — one-click SSO with the IdP session already
// established earlier in the run. A team is a shared board with lanes; tasks are
// added straight into the active lane.
import { approveIfPrompted, click, fillEmail } from '../story-kit.mjs'

export default async function run({ kit, page, TASKS, EMAIL }) {
  await kit.story({
    app: 'openape-tasks',
    category: 'Getting started',
    id: 'your-first-board',
    title: 'Create a board and add tasks',
    intro: 'Tasks keeps a shared to-do board for humans and agents. Sign in with your passkey, make a team, and drop work into its lanes — the same board an agent reads over the `ape-tasks` CLI.',
  }, async (s) => {
    await s.step('Sign in with one click', {
      do: async () => {
        await page.goto(TASKS, { waitUntil: 'networkidle' })
        await fillEmail(page, EMAIL)
        await click(page, /login with openape|sign in|login|anmelden/i)
        await page.waitForTimeout(2500)
        await approveIfPrompted(page)
        await page.waitForURL(/tasks\.openape\.test\/teams/, { timeout: 20000 }).catch(() => {})
        await page.waitForTimeout(2000)
      },
      shot: 'teams',
    }, 'One click and you are in — same passkey, same IdP. You land on your teams; a fresh account starts empty, ready for its first board.')

    await s.step('Create a team', {
      do: async () => {
        await page.goto(`${TASKS}/teams/new`, { waitUntil: 'networkidle' })
        await page.getByPlaceholder('Delta Mind').fill('Delta Mind')
        await click(page, /create team/i)
        await page.waitForTimeout(2500)
      },
      shot: 'board',
    }, 'A team is a shared board with Open / Doing / Done lanes. Everyone you invite — and every agent you authorise — sees the same columns.')

    await s.step('Add a couple of tasks', {
      do: async () => {
        for (const title of ['Ship the Q3 launch page', 'Draft the release notes']) {
          const input = page.getByPlaceholder(/new task/i).first()
          await input.fill(title)
          await input.press('Enter')
          await page.waitForTimeout(1500)
        }
      },
      shot: 'tasks-added',
    }, 'Type a task and press Enter — it lands in the active lane. Drag it between lanes as it moves, or let an agent pick it up with `ape-tasks list --status open`.')
  })
}
