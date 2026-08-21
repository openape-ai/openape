// Aggregate every app's story-guide (apps/<app>/docs/stories.json, written by
// compose/distribute-docs.mjs from the live E2E captures) into a single "Apps"
// section on docs.openape.ai. One Markdown page per app under
// content/5.apps/, screenshots copied into public/guides/<app>/.
//
//   node scripts/aggregate-guides.mjs
//
// Committed output, so the docs build never depends on a capture run. This
// script wipes and rewrites content/5.apps/ + public/guides/ — edit the story
// captions in compose/demo/stories/, not the generated pages.
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const docsRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const monorepoRoot = join(docsRoot, '..', '..')

// dir under apps/ → { slug, title } for the guide page + screenshot folder.
// An app only appears here once it has captured guides (apps/<app>/docs/
// stories.json). openape-monitor, openape-question-service and
// openape-dashboard run in prod but have no story-kit story and no local-stack
// service yet, so they have no page in this section — add
// compose/demo/stories/<app>.mjs and a local-stack service first, then list
// them here.
const APPS = [
  { dir: 'openape-free-idp', slug: 'idp', title: 'OpenApe ID' },
  { dir: 'openape-troop', slug: 'troop', title: 'Troop' },
  { dir: 'openape-chat', slug: 'chat', title: 'Chat' },
  { dir: 'openape-tasks', slug: 'tasks', title: 'Tasks' },
  { dir: 'openape-plans', slug: 'plans', title: 'Plans' },
  { dir: 'openape-testrun', slug: 'testrun', title: 'Testrun' },
  { dir: 'openape-timetrack', slug: 'timetrack', title: 'Timetrack' },
  { dir: 'openape-pr', slug: 'pr', title: 'PR' },
  { dir: 'openape-crm', slug: 'crm', title: 'CRM' },
]

/**
 * Kurzfassung an der letzten Wortgrenze — ein harter Schnitt endet mitten im
 * Wort, und dieser Text ist auch die OG-Beschreibung der Seite.
 */
function summarize(text, max) {
  const flat = text.replace(/\n/g, ' ').trim()
  if (flat.length <= max) return flat
  const cut = flat.slice(0, max - 1)
  const lastSpace = cut.lastIndexOf(' ')
  return `${(lastSpace > max / 2 ? cut.slice(0, lastSpace) : cut).replace(/[,;:.\s]+$/, '')}…`
}

const sectionDir = join(docsRoot, 'content', '5.apps')
const shotsRoot = join(docsRoot, 'public', 'guides')
rmSync(sectionDir, { recursive: true, force: true })
rmSync(shotsRoot, { recursive: true, force: true })
mkdirSync(sectionDir, { recursive: true })

writeFileSync(join(sectionDir, '.navigation.yml'), 'title: Apps\nicon: i-lucide-layout-grid\n')

const overview = []
let written = 0
APPS.forEach((app, i) => {
  const storiesPath = join(monorepoRoot, 'apps', app.dir, 'docs', 'stories.json')
  if (!existsSync(storiesPath)) {
    console.warn(`[aggregate-guides] skip ${app.slug}: no stories.json`)
    return
  }
  const { stories } = JSON.parse(readFileSync(storiesPath, 'utf8'))
  if (!stories?.length) return

  // Copy this app's screenshots into public/guides/<slug>/.
  const shotsSrc = join(monorepoRoot, 'apps', app.dir, 'public', 'docs', 'screenshots')
  if (existsSync(shotsSrc)) cpSync(shotsSrc, join(shotsRoot, app.slug), { recursive: true })

  const ordered = [...stories].sort((a, b) => a.order - b.order)
  // JSON.stringify → a valid double-quoted YAML scalar; intros carry colons and
  // em-dashes that would otherwise turn the frontmatter into a nested map (and
  // hand the OG renderer an object instead of a string).
  const intro = ordered[0].intro ?? `How ${app.title} is used, step by step.`
  const desc = summarize(intro, 200)
  overview.push({ ...app, blurb: summarize(intro, 130) })
  const lines = [
    '---',
    `title: ${JSON.stringify(app.title)}`,
    `description: ${JSON.stringify(desc)}`,
    '---',
    '',
    // Kein `# ${app.title}` im Body: das Frontmatter-`title` rendert bereits
    // als Seitenueberschrift, ein zweites H1 stellt denselben Namen doppelt.
    '::note',
    'Every step below is captured from a live end-to-end run on the local stack — the screenshots refresh on each capture, so this guide cannot drift from the real product.',
    '::',
    '',
  ]
  for (const s of ordered) {
    lines.push(`## ${s.title}`, '')
    if (s.intro) lines.push(s.intro, '')
    for (const step of s.steps) {
      lines.push(`### ${step.title}`, '')
      if (step.caption) lines.push(step.caption, '')
      if (step.shot) lines.push(`![${step.title}](/guides/${app.slug}/${step.shot})`, '')
    }
  }
  const prefix = String(i + 2).padStart(2, '0')
  writeFileSync(join(sectionDir, `${prefix}.${app.slug}.md`), `${lines.join('\n')}\n`)
  written++
})

// Ohne diese Seite ist /apps ein 404: die Sektion existiert sonst nur als
// Navigationsgruppe, und genau diese URL verlinken README und run.sh.
const indexLines = [
  '---',
  'title: Overview',
  `description: ${JSON.stringify(`Every OpenApe app, documented from a live end-to-end run: ${overview.map(a => a.title).join(', ')}.`)}`,
  '---',
  '',
  'Every app below is documented from a live end-to-end run on the local stack — a headless browser drives the real flow, and the screenshots are captured as it goes. The guide cannot drift from the product because it *is* the test run.',
  '',
  '::card-group',
  ...overview.flatMap(app => [
    `  ::card{title="${app.title}" icon="i-lucide-app-window" to="/apps/${app.slug}"}`,
    `  ${app.blurb}`,
    '  ::',
  ]),
  '::',
]
writeFileSync(join(sectionDir, '01.index.md'), `${indexLines.join('\n')}\n`)

console.log(`[aggregate-guides] wrote ${written} app guides + the overview → content/5.apps/ + public/guides/`)
