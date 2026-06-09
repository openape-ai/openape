// Distribute the E2E screenshots to the apps that document them, then
// regenerate each app's /docs HTML. Each app hosts its own `/docs` route
// (a Nuxt page rendering apps/<app>/docs/flows.md), so its screenshots must
// live in apps/<app>/public/docs/screenshots — this keeps that in sync with
// what the runners captured in docs/local-stack/screenshots.
//
//   node compose/distribute-docs.mjs
// (the demo + agent runners call this at the end of a capture.)

import { copyFileSync, existsSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const src = join(root, 'docs', 'local-stack', 'screenshots')

// Which captured screenshots each app documents — see apps/<app>/docs/flows.md.
const ownedBy = {
  'openape-free-idp': [
    '01-idp-landing',
    '02-idp-request-link',
    '03-idp-register-passkey',
    '04-idp-registered',
  ],
  'openape-troop': [
    '05-troop-landing',
    '06-idp-authorize-troop',
    '07-troop-dashboard',
    'agent-01-spawned',
    'agent-02-ran',
    'agent-03-destroyed',
  ],
  'openape-chat': [
    '08-chat-landing',
    '09-chat-dashboard',
  ],
  'openape-org': [
    '10-org-landing',
    '11-org-home',
  ],
}

for (const [app, shots] of Object.entries(ownedBy)) {
  const dest = join(root, 'apps', app, 'public', 'docs', 'screenshots')
  mkdirSync(dest, { recursive: true })
  let copied = 0
  for (const s of shots) {
    const from = join(src, `${s}.png`)
    if (existsSync(from)) {
      copyFileSync(from, join(dest, `${s}.png`))
      copied++
    }
  }
  const buildDocs = join(root, 'apps', app, 'scripts', 'build-docs.mjs')
  if (existsSync(buildDocs)) execFileSync('node', [buildDocs], { stdio: 'inherit' })
  console.log(`[distribute-docs] ${app}: ${copied}/${shots.length} screenshots → public/docs, /docs HTML regenerated`)
}
