// OpenApe Timetrack user story: set up a company and project, then open your
// timesheet.
//
// Timetrack is a DDISA Service Provider — sign in once (the IdP session is
// already established). Time is logged against a project, which lives under a
// company, so getting started is: make a company, add a project, open /me.
import { approveIfPrompted, click, fillEmail } from '../story-kit.mjs'

export default async function run({ kit, page, TIMETRACK, EMAIL }) {
  await kit.story({
    app: 'openape-timetrack',
    category: 'Getting started',
    id: 'set-up-time-tracking',
    title: 'Set up a project and track time',
    intro: 'Timetrack logs hours against projects for you and your agents. Sign in, create a company and a project, and your monthly timesheet is ready — log entries in the browser or let an agent post them over the API.',
  }, async (s) => {
    await s.step('Sign in with one click', {
      do: async () => {
        await page.goto(TIMETRACK, { waitUntil: 'networkidle' })
        await fillEmail(page, EMAIL)
        await click(page, /login with openape|sign in|login|anmelden/i)
        await page.waitForTimeout(2500)
        await approveIfPrompted(page)
        await page.waitForURL(/timetrack\.openape\.test\/(me|companies)/, { timeout: 20000 }).catch(() => {})
        await page.waitForTimeout(2000)
      },
      shot: 'me',
    }, 'One click and you are in. Your timesheet opens on the current month — empty until you set up a project to book against.')

    await s.step('Set up companies and projects', {
      do: async () => {
        await page.goto(`${TIMETRACK}/companies`, { waitUntil: 'networkidle' })
        await page.waitForTimeout(1500)
      },
      shot: 'companies',
    }, 'Time is booked against a project, and projects live under a company. Add a company, then a project for each thing you work on — clients, internal work, a side build.')

    await s.step('Log a day', {
      do: async () => {
        await page.goto(`${TIMETRACK}/me`, { waitUntil: 'networkidle' })
        await page.waitForTimeout(1500)
      },
      shot: 'entry',
    }, 'Pick a day, choose the project, enter start and end (or a plain duration) and log it. An agent can post the same entries over the API, so a full timesheet falls out of the work you already track.')
  })
}
