// OpenApe Coder user stories — the cloud home for software projects.
// One sign-in carries through: create a project, give it a vision and repos,
// add a user story, browse the board, and open the team panel.
import { approveIfPrompted, click, fillEmail } from '../story-kit.mjs'

export default async function run({ kit, page, EMAIL, CODER }) {
  await kit.story({
    app: 'openape-coder',
    category: 'Getting started',
    id: 'sign-in',
    title: 'Sign in to Coder',
    intro: 'Coder is where a software project lives: its vision, the repos it touches, its team and its user stories. Like every OpenApe app you sign in with your email domain and a passkey — no new account, no password.',
  }, async (s) => {
    await s.step('Open Coder', {
      do: () => page.goto(CODER, { waitUntil: 'networkidle' }),
      shot: 'landing',
    }, 'The start page is the sign-in: enter your email and continue.')

    await s.step('Signed in — your projects', {
      do: async () => {
        await fillEmail(page, EMAIL)
        await click(page, /continue|weiter|sign in with openape|sign in|login|anmelden/i)
        await page.waitForTimeout(2500)
        await approveIfPrompted(page)
        await page.waitForURL(/coder\.openape\.test/, { timeout: 20000 }).catch(() => {})
        await page.waitForTimeout(2500)
      },
      shot: 'home-empty',
    }, 'On your first visit the list is empty. You only ever see projects you belong to — nobody outside a project can tell it, or its people, exist.')
  })

  await kit.story({
    app: 'openape-coder',
    category: 'Projects',
    id: 'create-project',
    title: 'Create a project',
    intro: 'A project is the home for one software effort. You create it, become its admin, and give it a vision and the repos it touches — the shared context everyone on the team reads.',
  }, async (s) => {
    await s.step('Start a new project', {
      do: async () => {
        await click(page, /new project/i)
        await page.waitForTimeout(800)
      },
      shot: 'dialog',
    }, 'Click **New project** and name it. As its creator you become the project admin.')

    await s.step('Name it', {
      do: async () => {
        await page.getByPlaceholder(/payments rewrite/i).fill('Invoice Exporter')
        await click(page, /create project/i)
        await page.waitForURL(/\/projects\//, { timeout: 15000 }).catch(() => {})
        await page.waitForTimeout(2000)
      },
      shot: 'project-page',
    }, 'The project page opens: an overview with its vision and repos, a members panel, and the story board.')

    await s.step('Vision and repos', {
      do: async () => {
        await page.getByPlaceholder(/describe the project/i).fill('Let accountants export every invoice at once instead of one by one.')
        await page.getByPlaceholder(/github\.com/i).fill('https://github.com/acme/invoice-exporter')
        await click(page, /save changes/i)
        await page.waitForTimeout(1500)
      },
      shot: 'scope-saved',
    }, 'The vision is plain prose; the repos are full URLs to the code it touches — GitHub, GitLab, Forgejo or self-hosted, never just `owner/repo`. Both stay editable as the project grows.')
  })

  await kit.story({
    app: 'openape-coder',
    category: 'Stories',
    id: 'add-story',
    title: 'Add a user story',
    intro: 'User stories live in the project, where everyone can see them — not in mail threads. A story has the usual parts and can carry repos, links, test references and a status.',
  }, async (s) => {
    await s.step('Open the story board', {
      do: async () => {
        await click(page, /story board/i)
        await page.waitForURL(/\/stories$/, { timeout: 15000 }).catch(() => {})
        await page.waitForTimeout(1500)
      },
      shot: 'board-empty',
    }, 'The board shows every story in the project at a glance. It is empty for a new project.')

    await s.step('Write the story', {
      do: async () => {
        await click(page, /new story/i)
        await page.waitForTimeout(800)
        await page.getByPlaceholder(/bulk export of invoices/i).fill('Bulk export of invoices')
        await page.getByPlaceholder(/as an accountant/i).fill('As an accountant I want to export all invoices at once so that I can file them in one step.')
      },
      shot: 'story-dialog',
    }, 'Give it a title and the story sentence — *As … I want … so that …*. The optional repos, links and test references can be added afterwards.')

    await s.step('Story created', {
      do: async () => {
        await click(page, /create story/i)
        await page.waitForTimeout(1800)
      },
      shot: 'story-detail',
    }, 'The story opens, laid out for reading — sentence, criteria and any references — no files or code to open.')
  })

  await kit.story({
    app: 'openape-coder',
    category: 'Stories',
    id: 'story-board',
    title: 'Browse the board',
    intro: 'Back on the board, every story shows its status. Group or filter to see exactly where the project stands.',
  }, async (s) => {
    await s.step('All stories with status', {
      do: async () => {
        await page.goto(`${CODER}`, { waitUntil: 'networkidle' })
        await page.waitForTimeout(1000)
        await click(page, /invoice exporter/i, { optional: true })
        await page.waitForTimeout(1200)
        await click(page, /story board/i)
        await page.waitForTimeout(1500)
      },
      shot: 'board',
    }, 'Each story carries a status badge. The board groups them so you read the project state in one look.')
  })

  await kit.story({
    app: 'openape-coder',
    category: 'Team',
    id: 'invite-members',
    title: 'Invite the team',
    intro: 'A project admin adds people by email and controls, per member, what they may do. No email is sent — a new member is added read-only and sees it in their inbox at the next sign-in. Every write capability is granted explicitly.',
  }, async (s) => {
    await s.step('Open the members panel', {
      do: async () => {
        await page.goto(`${CODER}`, { waitUntil: 'networkidle' })
        await page.waitForTimeout(1000)
        await click(page, /invoice exporter/i)
        await page.waitForURL(/\/projects\//, { timeout: 15000 }).catch(() => {})
        await page.waitForTimeout(1200)
        // Members is a tab (role=tab), not a button/link.
        await page.getByRole('tab', { name: /members/i }).click()
        await page.waitForTimeout(1200)
      },
      shot: 'members',
    }, 'The Members panel lists who belongs to the project and their role.')

    await s.step('Add by email', {
      do: async () => {
        await click(page, /invite member/i)
        await page.waitForTimeout(800)
        await page.getByPlaceholder(/person@example/i).fill('teammate@openape.test')
      },
      shot: 'invite-dialog',
    }, 'Add a person by email address. The app never reveals whether that address already has an OpenApe identity — and only a human admin, never an agent, can do it.')

    await s.step('They\'ll see it in their inbox', {
      do: async () => {
        await click(page, /add member/i)
        await page.waitForTimeout(1200)
      },
      shot: 'member-added',
    }, 'No email is sent: the new member is added as read-only and learns of it from an inbox notification the next time they sign in. The optional button drafts a heads-up in your own mail client — nothing leaves through our server.')
  })
}
