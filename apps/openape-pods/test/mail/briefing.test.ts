// @vitest-environment node
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, expect, it, vi } from 'vitest'

const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })
async function example(name: string) { return import(/* @vite-ignore */ pathToFileURL(join(process.cwd(), 'examples', name)).href) }
function judgment(choice = 'completed', confidence = 0.95) { return { type: 'choice', choice, confidence, probabilities: { action: 0.01, keep: 0.01, newsletter: 0.01, completed: 0.97 } } }
function jevFixture(choice = 'completed', confidence = 0.95) {
  return vi.fn(async ({ state, questions }: { state: { messages: { id: string }[] }, questions: Record<string, unknown> }) => {
    expect(new TextEncoder().encode(JSON.stringify({ state, questions })).length).toBeLessThan(128 * 1024)
    return { model: 'jev-1.13.0', answers: Object.fromEntries(state.messages.flatMap((_, index) => [[`category_${index}`, judgment(choice, confidence)], [`priority_${index}`, { type: 'score', score: 2, confidence: 0.8 }]])) }
  })
}
it('bounds Jev state and retains conversations that cannot be reviewed completely without an LLM', async () => {
  const { classify } = await example('mail-triage.mjs')
  const messages = Array.from({ length: 20 }, (_, id) => ({ id: String(id), version: 'one', sender: 'sender@example.test', body: 'x'.repeat(6000), conversation: String(id) }))
  const evaluate = jevFixture(); const run = vi.fn()
  const result = await classify({ jev: { evaluate }, agent: { run } }, messages, [{ id: '0', messages: [{ body: 'x'.repeat(120000) }], truncated: false }])
  expect(result).toHaveLength(20); expect(result[0]).toMatchObject({ id: '0', disposition: 'keep' })
  expect(evaluate).toHaveBeenCalledTimes(2); expect(run).not.toHaveBeenCalled()
})
it('retains protected and uncertain archive candidates even if Jev chooses completed', async () => {
  const { classify } = await example('mail-triage.mjs')
  const message = { id: '1', version: 'one', sender: 'sender@example.test' }
  expect(await classify({ jev: { evaluate: jevFixture() } }, [{ ...message, protected: true }])).toMatchObject([{ disposition: 'keep' }])
  expect(await classify({ jev: { evaluate: jevFixture('completed', 0.4) } }, [message])).toMatchObject([{ disposition: 'keep' }])
  expect(await classify({ jev: { evaluate: jevFixture() } }, [message])).toMatchObject([{ disposition: 'archive' }])
})
it('does not fall back to an LLM if Jev fails and refuses summary attempts to change dispositions', async () => {
  const { classify, summarize } = await example('mail-triage.mjs')
  const message = { id: '1', version: 'one', sender: 'sender@example.test' }
  const run = vi.fn(async () => ({ response: JSON.stringify([{ id: '1', summary: 'A summary.', nextAction: '', disposition: 'archive' }]) }))
  await expect(classify({ jev: { evaluate: async () => { throw new Error('Jev unavailable') } }, agent: { run } }, [message])).rejects.toThrow('Jev unavailable')
  expect(run).not.toHaveBeenCalled()
  await expect(summarize({ agent: { run } }, [message])).rejects.toThrow('Invalid important-mail summaries')
})
it('renders actionable mail and the exact grant link alongside calendar and issue sections', async () => {
  const { render } = await example('morning-mail-briefing.mjs')
  const text = render(new Date('2026-09-26T05:00:00Z'), [{ today: [], upcoming: [] }, { repos: { total: 1, issues: [{ title: 'An open issue', repository: 'patrick/monorepo', number: 123, url: 'https://repos.openape.ai/patrick/monorepo/issues/123' }] } }], { date: '2026-09-26', accounts: [{ account: 'owner@example.test', total: 12, checked: 12, important: [{ disposition: 'action', subject: 'Please confirm', receivedAt: '2026-09-22T13:47:13Z', sender: 'partner@example.test', summary: 'A decision is due today.', nextAction: 'Reply before noon.' }], archiveCount: 3, grant: { count: 3, url: 'https://id.example.test/grant-approval?grant_id=fixture' } }], gaps: [] })
  for (const textPart of ['Please confirm', '22.09.2026', 'A decision is due today.', 'Reply before noon.', '3 Mails zum Archivieren', 'grant_id=fixture', 'An open issue', 'Keine Termine heute']) expect(text).toContain(textPart)
  expect(text.length).toBeLessThan(4097)
})
it('requires current workflow output rather than silently reporting no mail', async () => {
  const { render } = await example('morning-mail-briefing.mjs')
  expect(() => render(new Date(), [{ today: [], upcoming: [] }, { repos: { total: 0, issues: [] } }], undefined)).toThrow('Current workflow mail review')
})
it('manual triage cannot process archive approvals', async () => {
  const { run } = await example('mail-triage.mjs')
  const process = vi.fn()
  expect(await run({ input: { eventIds: [], reason: 'manual', checkpointRevision: 0, checkpoint: {} }, variables: { delivery_mode: 'live' }, mail: { archive: { process } } })).toMatchObject({ status: 'completed' })
  expect(process).not.toHaveBeenCalled()
})
it('publishes explicit mail-source gaps so the briefing can still explain missing coverage', async () => {
  const { run } = await example('mail-triage.mjs')
  const workspace = await mkdtemp(join(tmpdir(), 'pods-mail-review-')); roots.push(workspace)
  const publish = vi.fn(); let revision = 0
  const response = await run({ workspace, input: { eventIds: [], reason: 'manual', workflow: { runId: 'fixture', outputs: {} }, checkpointRevision: 0, checkpoint: {} }, variables: { delivery_mode: 'live' }, workflow: { publish }, tools: { invoke: async () => ({ exitCode: 1 }) }, progress: { commit: async () => ({ revision: ++revision }) } })
  expect(response.status).toBe('completed')
  expect(publish).toHaveBeenCalledWith({ schema: 'morning-mail-review/v1', data: expect.objectContaining({ gaps: [expect.stringContaining('delta-mind.at'), expect.stringContaining('docpit.eu')], preview: true }) })
})
