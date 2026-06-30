// OpenApe PR user story: review an agent's pull request.
//
// PR is agent-facing — an agent (`ape-pr push`) opens a PR with a diff; a human
// reviews it in the browser and the agent polls the verdict. The capturable
// part is the human review. Unlike testrun's public proof link, the review is
// auth-gated, so the story signs in (one-click SSO, the IdP session is already
// established earlier in the run) before opening the diff.
import { createHmac } from 'node:crypto'
import { approveIfPrompted, click, fillEmail } from '../story-kit.mjs'

// Dev-only secret + client_id from compose/local-stack.yml (x-dev-secret).
const SECRET = 'dev-session-secret-openape-test-0001'
const CLIENT_ID = 'pr.openape.test'

function b64url(input) {
  return Buffer.from(input).toString('base64url')
}

function forgeCliToken() {
  const now = Math.floor(Date.now() / 1000)
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  const payload = b64url(JSON.stringify({
    typ: 'cli', sub: 'agent+ci@openape.test', email: 'agent+ci@openape.test', act: 'agent',
    iss: CLIENT_ID, aud: CLIENT_ID, iat: now, exp: now + 3600,
  }))
  const sig = Buffer.from(createHmac('sha256', SECRET).update(`${header}.${payload}`).digest()).toString('base64url')
  return `${header}.${payload}.${sig}`
}

const SAMPLE_DIFF = `diff --git a/server/rate-limit.ts b/server/rate-limit.ts
index 1a2b3c4..5d6e7f8 100644
--- a/server/rate-limit.ts
+++ b/server/rate-limit.ts
@@ -8,7 +8,11 @@ const buckets = new Map<string, Bucket>()
 export function checkLimit(ip: string): boolean {
   const now = Date.now()
   const bucket = buckets.get(ip) ?? { count: 0, reset: now + WINDOW_MS }
+  // Roll the window over once it expires, otherwise a quiet client stays
+  // capped forever on its first burst.
+  if (now > bucket.reset) {
+    bucket.count = 0
+    bucket.reset = now + WINDOW_MS
+  }
   bucket.count++
   buckets.set(ip, bucket)
   return bucket.count <= MAX_PER_WINDOW
 }
`

export default async function run({ kit, page, PR, EMAIL }) {
  // Agent side: open the PR for review (ape-pr push equivalent).
  const res = await page.request.post(`${PR}/api/prs`, {
    headers: { 'Authorization': `Bearer ${forgeCliToken()}`, 'content-type': 'application/json' },
    data: {
      title: 'Reset the rate-limit window when it expires',
      description: 'A quiet client that bursts once stays capped forever — the window never rolls over. Reset the bucket when `now` passes `reset`.',
      author: 'agent+ci@openape.test',
      authorAct: 'agent',
      branch: 'fix/rate-limit-window',
      diff: SAMPLE_DIFF,
    },
  })
  const { id } = await res.json()

  await kit.story({
    app: 'openape-pr',
    category: 'Getting started',
    id: 'review-an-agent-pr',
    title: 'Review an agent\'s pull request',
    intro: 'When an agent opens a PR it lands here for a human to approve before anything merges. Sign in once and every agent diff waits for your verdict.',
  }, async (s) => {
    await s.step('Sign in to PR', {
      do: async () => {
        await page.goto(PR, { waitUntil: 'networkidle' })
        await fillEmail(page, EMAIL)
        await click(page, /sign in with openape|sign in|login|anmelden/i)
        await page.waitForTimeout(2500)
        await approveIfPrompted(page)
        await page.waitForURL(/pr\.openape\.test/, { timeout: 20000 }).catch(() => {})
        await page.waitForTimeout(2500)
      },
      shot: 'inbox',
    }, 'Your review inbox: every PR an agent opened, newest first, each tagged with who authored it (🤖 for an agent) and its diff size.')

    await s.step('Read the diff and decide', {
      do: async () => {
        await page.goto(`${PR}/prs/${id}`, { waitUntil: 'networkidle' })
        await page.waitForTimeout(2000)
      },
      shot: 'review',
    }, 'The full diff rendered file by file, additions and deletions side by side. Approve or request changes — the agent is polling for your verdict and continues the moment you decide.')
  })
}
