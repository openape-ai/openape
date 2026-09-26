// @vitest-environment node
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, expect, it, vi } from 'vitest'

const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })
async function example(name: string) { return import(/* @vite-ignore */ pathToFileURL(join(process.cwd(), 'examples', name)).href) }
it('bounds classification prompts and retains conversations that cannot be reviewed completely', async () => {
  const { classify } = await example('mail-triage.mjs')
  const messages = Array.from({ length: 20 }, (_, id) => ({ id: String(id), version: 'one', sender: 'sender@example.test', body: 'x'.repeat(6000), conversation: String(id) }))
  const run = vi.fn(async ({ prompt }: { prompt: string }) => {
    expect(prompt.length).toBeLessThan(128 * 1024)
    const data = JSON.parse(prompt.split('\n\n').at(-1)!)
    return { response: JSON.stringify(data.messages.map((mail: { id: string }) => ({ id: mail.id, disposition: 'archive', priority: 1, summary: 'Reviewed', reason: 'Completed', nextAction: '' }))) }
  })
  const result = await classify({ agent: { run } }, messages, [{ id: '0', messages: [{ body: 'x'.repeat(120000) }], truncated: false }])
  expect(result).toHaveLength(20)
  expect(result[0]).toMatchObject({ id: '0', disposition: 'keep' })
  expect(run).toHaveBeenCalledTimes(2)
})
it('renders actionable mail and the exact grant link alongside calendar and issue sections', async () => {
  const { render } = await example('morning-mail-briefing.mjs')
  const text = render(new Date('2026-09-26T05:00:00Z'), [{ today: [], upcoming: [] }, { repos: { total: 1, issues: [{ title: 'An open issue', repository: 'patrick/monorepo', number: 123, url: 'https://repos.openape.ai/patrick/monorepo/issues/123' }] } }], { date: '2026-09-26', accounts: [{ account: 'owner@example.test', total: 12, checked: 12, important: [{ disposition: 'action', subject: 'Please confirm', sender: 'partner@example.test', summary: 'A decision is due today.', nextAction: 'Reply before noon.' }], archiveCount: 3, grant: { count: 3, url: 'https://id.example.test/grant-approval?grant_id=fixture' } }], gaps: [] })
  for (const textPart of ['Please confirm', 'A decision is due today.', 'Reply before noon.', '3 Mails zum Archivieren', 'grant_id=fixture', 'An open issue', 'Keine Termine heute']) expect(text).toContain(textPart)
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
