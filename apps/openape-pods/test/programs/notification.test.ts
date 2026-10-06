// @vitest-environment node
import { readFile } from 'node:fs/promises'
import { expect, it, vi } from 'vitest'

async function fixture() {
  const code = await readFile('examples/mail-notification.mjs', 'utf8')
  const script = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`)
  let checkpoint: Record<string, unknown> = {}; let revision = 0
  const state = { ids: ['old'], fail: false }
  const tools = vi.fn(async () => ({ exitCode: 0, stdout: JSON.stringify({ account: 'pod@example.invalid', operation: 'messages', items: state.ids.map(id => ({ id })), complete: true }) }))
  const http = vi.fn(async () => { if (state.fail) throw new Error('Synthetic delivery interruption'); return { status: 200, headers: {}, body: '{"ok":true}' } })
  const run = () => script.run({ variables: { mail_account: 'pod@example.invalid', telegram_chat_id: 'synthetic-chat' }, input: { checkpoint: structuredClone(checkpoint), checkpointRevision: revision, eventIds: [] }, tools: { invoke: tools }, credentials: { get: async () => '123:SYNTHETIC_TOKEN' }, http: { request: http }, progress: { commit: async (value: { expectedRevision: number, checkpoint: Record<string, unknown> }) => { expect(value.expectedRevision).toBe(revision); checkpoint = structuredClone(value.checkpoint); return { revision: ++revision } } } })
  return { run, state, tools, http, checkpoint: () => checkpoint }
}
it('mail notification recipe establishes a quiet baseline, reports only new identities and never stores the token', async () => {
  const f = await fixture()
  expect((await f.run()).summary).toContain('baseline')
  expect(f.tools).toHaveBeenCalledWith(expect.objectContaining({ application: 'o365-cli' }))
  expect(f.http).not.toHaveBeenCalled()
  f.state.ids = ['old', 'new']
  expect((await f.run()).summary).toBe('Reported 1 new email(s)')
  expect(f.http).toHaveBeenCalledTimes(1)
  expect(JSON.stringify(f.checkpoint())).not.toContain('SYNTHETIC_TOKEN')
  expect((await f.run()).summary).toBe('No new mail')
  expect(f.http).toHaveBeenCalledTimes(1)
})
it('mail notification recipe resumes its persisted request with the same effect key before fetching another page', async () => {
  const f = await fixture(); await f.run(); f.state.ids.push('new'); f.state.fail = true
  await expect(f.run()).rejects.toThrow('Synthetic delivery interruption')
  const pending = structuredClone(f.checkpoint().pending)
  expect(pending).toBeDefined(); const reads = f.tools.mock.calls.length
  f.state.fail = false
  expect((await f.run()).summary).toBe('Pending mail notification completed')
  expect(f.tools).toHaveBeenCalledTimes(reads)
  expect(f.http.mock.calls[0]).toEqual(f.http.mock.calls[1])
  expect(f.checkpoint().pending).toBeUndefined()
})
