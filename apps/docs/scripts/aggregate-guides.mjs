// Aggregate every app's story-guide (apps/<app>/docs/stories.json, written by
// compose/distribute-docs.mjs from the live E2E captures) into a single "Apps"
// section on docs.openape.ai. One Markdown page per app under
// content/5.apps/, screenshots copied into public/guides/<app>/.
//
//   node scripts/aggregate-guides.mjs
//
// Committed output, so the docs build never depends on a capture run.
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const docsRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const monorepoRoot = join(docsRoot, '..', '..')

// dir under apps/ → { slug, title } for the guide page + screenshot folder.
const APPS = [
  { dir: 'openape-free-idp', slug: 'idp', title: 'OpenApe ID' },
  { dir: 'openape-troop', slug: 'troop', title: 'Troop' },
  { dir: 'openape-chat', slug: 'chat', title: 'Chat' },
  { dir: 'openape-coder', slug: 'coder', title: 'Coder' },
  { dir: 'openape-tasks', slug: 'tasks', title: 'Tasks' },
  { dir: 'openape-plans', slug: 'plans', title: 'Plans' },
  { dir: 'openape-testrun', slug: 'testrun', title: 'Testrun' },
  { dir: 'openape-timetrack', slug: 'timetrack', title: 'Timetrack' },
  { dir: 'openape-pr', slug: 'pr', title: 'PR' },
]

const sectionDir = join(docsRoot, 'content', '5.apps')
const shotsRoot = join(docsRoot, 'public', 'guides')
rmSync(sectionDir, { recursive: true, force: true })
rmSync(shotsRoot, { recursive: true, force: true })
mkdirSync(sectionDir, { recursive: true })

writeFileSync(join(sectionDir, '.navigation.yml'), 'title: Apps\nicon: i-lucide-layout-grid\n')

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
  const desc = (ordered[0].intro ?? `How ${app.title} is used, step by step.`).replace(/\n/g, ' ').slice(0, 200)
  const lines = [
    '---',
    `title: ${JSON.stringify(app.title)}`,
    `description: ${JSON.stringify(desc)}`,
    '---',
    '',
    `# ${app.title}`,
    '',
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
  writeFileSync(join(sectionDir, `${i + 1}.${app.slug}.md`), `${lines.join('\n')}\n`)
  written++
})

console.log(`[aggregate-guides] wrote ${written} app guides → content/5.apps/ + public/guides/`)
