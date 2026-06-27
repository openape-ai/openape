// Shared scenario spec for the proof-link how-to guide. ONE source of truth for
// the ordered steps + their doc-prose captions + the equivalent CLI command.
// The browser capture (proof-link-guide.e2e.test.ts) fills in real screenshots
// and the real upload output; scripts/build-guide.mjs renders the HTML guide.
// Captions are product copy (present tense, reader-facing) — not test-speak.

export interface ScenarioStep {
  key: string
  caption: string
  cli: { command: string, output: string }
  /** If set, the browser track navigates here (`:slug` substituted) and shoots 3 viewports. */
  browserPath?: string
}

export const proofLinkScenario = {
  title: 'Einen Testlauf teilen',
  intro: 'Dieselben Schritte gehen per CLI und im Browser — generiert aus dem E2E-Lauf, daher immer aktuell.',
  // The run uploaded to drive the scenario.
  manifest: {
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
  },
  steps: [
    {
      key: 'upload',
      caption: 'Du lädst den Test-Report hoch und bekommst einen öffentlichen Beweis-Link zurück.',
      cli: { command: 'ape-testruns upload report.json', output: '' }, // output filled with the real slug/url
    },
    {
      key: 'view',
      caption: 'Wer den Link öffnet, sieht den gerenderten Report — Status, Tests, Schritte. Kein Login nötig.',
      cli: { command: 'curl -s https://testrun.openape.ai/api/public/runs/<slug> | jq .status', output: '"passed"' },
      browserPath: '/r/:slug',
    },
  ] satisfies ScenarioStep[],
}

export const VIEWPORTS = {
  desktop: { width: 1440, height: 900 },
  tablet: { width: 768, height: 1024 },
  mobile: { width: 390, height: 844 },
} as const
