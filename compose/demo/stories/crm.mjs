// OpenApe CRM user story: set up a pipeline, work a deal, shape the stages.
//
// CRM is a DDISA Service Provider — sign in once (the IdP session is already
// established). Everything hangs off a workspace, so the first run creates one;
// the deals behind the screenshots are seeded over the API with the very
// session the browser just got, the same way an agent would post them.
import { approveIfPrompted, click, fillEmail } from '../story-kit.mjs'

/** Seed a workspace worth showing — a company, a contact and deals across the board. */
async function seedPipeline(page, CRM) {
  const post = async (path, body) => {
    const res = await page.request.post(`${CRM}${path}`, { data: body })
    if (!res.ok()) throw new Error(`${path} → ${res.status()} ${await res.text()}`)
    return await res.json()
  }

  const [workspace] = await (await page.request.get(`${CRM}/api/workspaces`)).json()
  const ws = workspace.id

  const org = await post('/api/organizations', { workspace_id: ws, name: 'Nova AG', domain: 'nova.at' })
  const contact = await post('/api/contacts', {
    workspace_id: ws,
    name: 'Max Muster',
    email: 'max@nova.at',
    org_id: org.id,
  })

  const deal = await post('/api/deals', {
    workspace_id: ws,
    title: 'Website-Relaunch',
    value_cents: 1_800_000,
    stage: 'proposal',
    contact_id: contact.id,
    org_id: org.id,
  })
  await post(`/api/deals/${deal.id}/notes`, { body: 'Angebot verschickt, Rückmeldung bis Freitag.' })
  await post(`/api/deals/${deal.id}/notes`, { body: 'Budget bestätigt — Entscheidung im Vorstand am 25.' })

  await post('/api/deals', { workspace_id: ws, title: 'Wartungsvertrag 2027', value_cents: 960_000, stage: 'lead' })
  await post('/api/deals', { workspace_id: ws, title: 'CRM-Migration Nord AG', value_cents: 4_500_000, stage: 'qualified' })
  await post('/api/deals', { workspace_id: ws, title: 'Support-Retainer Alpha', value_cents: 1_200_000, stage: 'won' })
  return deal
}

export default async function run({ kit, page, CRM, EMAIL }) {
  await kit.story({
    app: 'openape-crm',
    category: 'Getting started',
    id: 'run-a-pipeline',
    title: 'Run a sales pipeline',
    intro: 'CRM keeps deals, contacts and notes in one board — for you and for the agents working alongside you. Sign in, create a workspace, and every deal moves from first contact to signature on the same pipeline. The `ape-crm` CLI drives all of it from the terminal.',
  }, async (s) => {
    await s.step('Sign in with one click', {
      do: async () => {
        await page.goto(CRM, { waitUntil: 'networkidle' })
        await fillEmail(page, EMAIL)
        await click(page, /login with openape|sign in|login|anmelden/i)
        await page.waitForTimeout(2500)
        await approveIfPrompted(page)
        await page.waitForURL(/crm\.openape\.test\/board/, { timeout: 20000 }).catch(() => {})
        await page.waitForTimeout(2000)
      },
      shot: 'first-run',
    }, 'One click and you are in — your passkey, your IdP. A fresh account asks for a workspace first: that is the shared container your deals, contacts and companies live in.')

    await s.step('Create a workspace', {
      do: async () => {
        await page.getByPlaceholder(/delta mind/i).fill('Delta Mind')
        await click(page, /anlegen|create/i)
        await page.waitForTimeout(2500)
      },
      shot: 'empty-board',
    }, 'Name the workspace and the board opens on a fresh pipeline: Lead, Qualifiziert, Angebot, Gewonnen, Verloren. Invite colleagues to it, or authorise an agent — everyone works the same board.')

    await s.step('Fill the pipeline', {
      do: async () => {
        await seedPipeline(page, CRM)
        await page.reload({ waitUntil: 'networkidle' })
        await page.waitForTimeout(1500)
      },
      shot: 'board',
    }, 'Each card carries its title, value and the person behind it; the column header sums what is riding on that stage. Drag a card to move it, and the closing columns stand out so a full pipeline reads at a glance.')

    await s.step('Open a deal', {
      do: async () => {
        await page.getByText('Website-Relaunch').first().click()
        await page.waitForTimeout(1800)
      },
      shot: 'deal',
    }, 'Click a card to work it: title, value, stage and contact are editable, and the note history sits right below. Every note is stamped with who wrote it and when — a human or an agent.')

    await s.step('Shape the pipeline', {
      do: async () => {
        await page.keyboard.press('Escape')
        await page.waitForTimeout(800)
        await page.locator('[aria-label="Stufe bearbeiten"]').last().click()
        await page.waitForTimeout(1200)
      },
      shot: 'stages',
    }, 'The columns are yours. Click a heading to rename it, use the menu to reorder or insert a stage, and add as many as your process needs — several loss reasons, for instance. Whether a stage closes a deal is a setting, not its name, so renaming never breaks the numbers.')

    await s.step('Contacts and companies', {
      do: async () => {
        await page.keyboard.press('Escape')
        await page.goto(`${CRM}/contacts`, { waitUntil: 'networkidle' })
        await page.waitForTimeout(1500)
      },
      shot: 'contacts',
    }, 'People and the companies they work for live behind the board. Link a contact to a deal and the card shows who to call — the same records `ape-crm contacts` reads and writes.')
  })
}
