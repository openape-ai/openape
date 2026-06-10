// Distribute the story-guide captures to the apps that own them, then
// regenerate each app's /docs guide. The runners (compose/demo/run-stories.mjs
// and compose/agent/lifecycle.mjs) write manifest fragments + per-story
// screenshots under docs/local-stack/; ownership lives in each story's `app`
// field — this merges the fragments, writes apps/<app>/docs/stories.json,
// copies that app's screenshots into apps/<app>/public/docs/screenshots/<story>/
// and runs the app's build-docs.mjs.
//
//   node compose/distribute-docs.mjs
// (the demo + agent runners call this at the end of a capture.)

import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const site = join(root, 'docs', 'local-stack')

// Merge all manifest fragments. The demo stories (sign-up, SSO) come before
// the agent-lifecycle ones in every guide, so fragments merge in explicit
// preference order and stories get renumbered globally (each runner counts
// its own `order` from 1).
const PREFERRED = ['manifest-demo.json', 'manifest-agent.json']
const fragments = readdirSync(site).filter(n => /^manifest-.*\.json$/.test(n))
fragments.sort((a, b) => {
  const ia = PREFERRED.indexOf(a)
  const ib = PREFERRED.indexOf(b)
  return (ia === -1 ? PREFERRED.length : ia) - (ib === -1 ? PREFERRED.length : ib) || a.localeCompare(b)
})
const stories = []
for (const f of fragments) {
  const { stories: part } = JSON.parse(readFileSync(join(site, f), 'utf8'))
  for (const s of [...part].sort((a, b) => a.order - b.order))
    stories.push({ ...s, order: stories.length + 1 })
  console.log(`[distribute-docs] ${f}: ${part.length} stories`)
}
if (stories.length === 0) {
  console.error('[distribute-docs] no manifest fragments found — run the story runners first')
  process.exit(1)
}

const byApp = new Map()
for (const s of stories) {
  if (!byApp.has(s.app))
    byApp.set(s.app, [])
  byApp.get(s.app).push(s)
}

for (const [app, appStories] of byApp) {
  const appDir = join(root, 'apps', app)
  if (!existsSync(appDir)) {
    console.error(`[distribute-docs] unknown app '${app}' in manifest`)
    process.exit(1)
  }
  mkdirSync(join(appDir, 'docs'), { recursive: true })
  writeFileSync(join(appDir, 'docs', 'stories.json'), `${JSON.stringify({ stories: appStories }, null, 2)}\n`)

  // Replace the app's screenshot tree with this run's captures.
  const shotsSrc = join(site, 'screenshots', app)
  const shotsDst = join(appDir, 'public', 'docs', 'screenshots')
  rmSync(shotsDst, { recursive: true, force: true })
  if (existsSync(shotsSrc))
    cpSync(shotsSrc, shotsDst, { recursive: true })

  const buildDocs = join(appDir, 'scripts', 'build-docs.mjs')
  if (existsSync(buildDocs))
    execFileSync('node', [buildDocs], { stdio: 'inherit' })
  console.log(`[distribute-docs] ${app}: ${appStories.length} stories → docs/stories.json + screenshots`)
}
