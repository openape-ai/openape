// Drive the user-story guides through a real headless Chromium on the local
// stack. Each story is an E2E test (see story-kit.mjs); the captions written
// in the stories become the per-app /docs guides. Run via compose/demo/run.sh.
//
// One browser context for the whole run: the passkey + IdP session created in
// the first story carry through — exactly like a real user's browser.

import { mkdirSync } from 'node:fs'
import process from 'node:process'
import { chromium } from 'playwright'
import { createStoryKit } from './story-kit.mjs'
import chatStories from './stories/chat.mjs'
import idpStories from './stories/idp.mjs'
import orgStories from './stories/org.mjs'
import troopStories from './stories/troop.mjs'

const OUT = '/demo/out'
mkdirSync(OUT, { recursive: true })

const browser = await chromium.launch({ args: ['--ignore-certificate-errors'] })
const context = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1280, height: 860 } })
const page = await context.newPage()
page.on('console', (m) => { if (m.type() === 'error') console.log(`[console.error] ${m.text()}`) })
page.on('pageerror', e => console.log(`[pageerror] ${e.message}`))

const client = await context.newCDPSession(page)
await client.send('WebAuthn.enable')
await client.send('WebAuthn.addVirtualAuthenticator', {
  options: {
    protocol: 'ctap2',
    transport: 'internal',
    hasResidentKey: true,
    hasUserVerification: true,
    isUserVerified: true,
    automaticPresenceSimulation: true,
  },
})

const kit = createStoryKit({ outDir: OUT, page })
const ctx = {
  kit,
  page,
  EMAIL: 'demo@openape.test',
  IDP: 'https://id.openape.test',
  TROOP: 'https://troop.openape.test',
  CHAT: 'https://chat.openape.test',
  ORG: 'https://org.openape.test',
  REG_TOKEN: process.env.REG_TOKEN || '',
}

for (const run of [idpStories, troopStories, chatStories, orgStories])
  await run(ctx)

const failures = kit.finish('demo')
await browser.close()
process.exit(failures > 0 ? 1 : 0)
