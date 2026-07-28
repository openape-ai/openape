// OpenApe Testrun user story: share a test run as a public proof link.
//
// Testrun is agent-facing — a CLI (`ape-testruns`) uploads a run report and
// gets back a public /r/<slug> link anyone can open without logging in. The
// browser-capturable part is that proof view, so the story uploads a run via
// the public API (forging the same SP-scoped CLI token the CLI mints) and then
// screenshots the rendered proof.
import { createHmac } from 'node:crypto'

// Dev-only secret + client_id from compose/local-stack.yml (x-dev-secret). The
// SP verifies a cli token whose issuer/audience equal its own client_id.
const SECRET = 'dev-session-secret-openape-test-0001'
const CLIENT_ID = 'testrun.openape.test'

function b64url(input) {
  return Buffer.from(input).toString('base64url')
}

function forgeCliToken() {
  const now = Math.floor(Date.now() / 1000)
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  const payload = b64url(JSON.stringify({
    typ: 'cli', sub: 'demo@openape.test', email: 'demo@openape.test', act: 'human',
    iss: CLIENT_ID, aud: CLIENT_ID, iat: now, exp: now + 3600,
  }))
  const sig = Buffer.from(createHmac('sha256', SECRET).update(`${header}.${payload}`).digest()).toString('base64url')
  return `${header}.${payload}.${sig}`
}

const manifest = {
  title: 'DDISA-Login mit Passkey',
  project: 'openape-free-idp',
  summary: 'Ein Nutzer meldet sich passwortlos an und ein Agent wird in seinem Namen autorisiert.',
  tests: [
    { id: 'login', title: 'Nutzer meldet sich mit Passkey an', status: 'passed', steps: [
      { title: 'Startseite', caption: 'Auf der Startseite gibst du deine E-Mail ein.', status: 'passed' },
      { title: 'Passkey', caption: 'Der Browser fragt deinen Passkey ab — kein Passwort nötig.', status: 'passed' },
    ] },
    { id: 'grant', title: 'Agent wird autorisiert', status: 'passed', steps: [
      { title: 'Consent', caption: 'Du genehmigst dem Agent den Zugriff in deinem Namen.', status: 'passed' },
    ] },
  ],
}

export default async function run({ kit, page, TESTRUN }) {
  // Upload a run report exactly as `ape-testruns upload` would, to get a real
  // proof link. page.request shares the context's ignoreHTTPSErrors, so the
  // local Caddy cert is fine.
  const res = await page.request.post(`${TESTRUN}/api/runs`, {
    headers: { 'Authorization': `Bearer ${forgeCliToken()}`, 'content-type': 'application/json' },
    data: manifest,
  })
  const created = await res.json()
  const slug = created.slug

  await kit.story({
    app: 'openape-testrun',
    category: 'Getting started',
    id: 'share-a-test-run',
    title: 'Share a test run as a proof link',
    intro: 'Testrun turns a CI report into a public proof link. An agent (or `ape-testruns upload report.json`) pushes the run; you get a `/r/<slug>` URL that renders status, tests and steps — no login to open it.',
  }, async (s) => {
    await s.step('The run lands as a report', {
      do: () => page.goto(TESTRUN, { waitUntil: 'networkidle' }),
      shot: 'landing',
    }, 'Testrun\'s start page. Reports arrive over the API — your pipeline runs `ape-testruns upload report.json` and gets a shareable link back.')

    await s.step('Open the proof link', {
      do: () => page.goto(`${TESTRUN}/r/${slug}`, { waitUntil: 'networkidle' }),
      shot: 'proof',
    }, 'Anyone with the link sees the rendered report — overall status, every test and its steps. Public by design, so you can paste it into a PR or a chat without making the reader log in.')
  })
}
