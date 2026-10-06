import { AGENT_STORAGE_STATE } from './constants'
import { expect, fillStable, test } from './fixture'

test.use({
  docMeta: {
    category: 'questions',
    title: 'Ask a question',
    description: 'You ask, a service agent answers, the page shows the result',
  },
})

const QUESTION = 'Welche Unterlagen brauche ich für die Reisekostenabrechnung?'
const ANSWER = 'Fahrkarten oder Kilometerstand, Hotelrechnung und die Einladung zur Veranstaltung — alles als PDF.'

test('ask a question and get an answer', async ({ page, browser, doc }) => {
  doc.section('Asking', 'Your question goes into a queue that the service agent works through.')

  await page.goto('/dashboard')
  await fillStable(page.getByPlaceholder('Frag irgendwas…'), QUESTION)
  await doc.step({
    action: 'Write your question',
    description: 'Plain language — the agent reads it as it stands.',
    shot: '01-question',
  })

  await page.getByRole('button', { name: 'Antwort generieren' }).click()
  await expect(page.getByText(/Warte auf Service-Agent/)).toBeVisible()
  await doc.step({
    action: 'Select Antwort generieren',
    description: 'The page waits and keeps checking; you can leave it open.',
    shot: '02-waiting',
  })

  // The agent side of the same queue, driven from a real page in a second
  // signed-in context. Not from `context.request`: the SP session cookies are
  // Secure, and while a browser treats http://127.0.0.1 as a trustworthy
  // origin and sends them, Playwright's API request context does not — the
  // call then arrives unauthenticated and the queue answers 401.
  const agent = await browser.newContext({ storageState: AGENT_STORAGE_STATE })
  const agentPage = await agent.newPage()
  await agentPage.goto('/dashboard')

  const claimed = await agentPage.evaluate(async () => {
    const res = await fetch('/api/agent/tasks/next', { method: 'POST' })
    return { ok: res.ok, body: await res.text() }
  })
  expect(claimed.ok, `agent could not claim a task: ${claimed.body}`).toBe(true)
  const { task } = JSON.parse(claimed.body) as { task: { id: string } | null }
  expect(task, 'the queue handed out no task').not.toBeNull()

  const resolved = await agentPage.evaluate(async ({ id, answer }) => {
    const res = await fetch('/api/agent/tasks/resolve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id,
        state: 'completed',
        artifact: { artifactId: 'answer', parts: [{ kind: 'text', text: answer }] },
      }),
    })
    return { ok: res.ok, body: await res.text() }
  }, { id: task!.id, answer: ANSWER })
  expect(resolved.ok, `agent could not resolve the task: ${resolved.body}`).toBe(true)
  await agent.close()

  doc.section('The answer', 'It appears on the page you left open.')

  await expect(page.getByText(ANSWER)).toBeVisible({ timeout: 30_000 })
  await doc.step({
    action: 'Read the answer',
    description: 'The question stays above it, so the two can be read together.',
    shot: '01-answer',
  })
})
