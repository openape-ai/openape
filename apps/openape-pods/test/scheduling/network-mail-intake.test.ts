// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })
async function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'pods-provider-intake-')); roots.push(root)
  const script = await import(pathToFileURL(resolve('examples/network-mail-intake.mjs')).href)
  const messages = { inbox: { id: 'immutable-inbox', changeKey: 'provider-v1' }, sent: { id: 'immutable-sent', changeKey: 'provider-v1' } }
  const invoke = vi.fn(async ({ argv }: { argv: string[] }) => {
    const folder = argv[argv.indexOf('--folder') + 1]
    const row = argv[0] === 'mail' ? messages[folder === 'Inbox' ? 'inbox' : 'sent'] : Object.values(messages).find(item => item.id === argv.at(-1))!
    const output = argv[0] === 'mail' ? [{ account: 'owner@example.invalid', message_id: row.id }] : { protocol: 'pods-mail/v1', account: 'owner@example.invalid', operation: 'read', outcome: 'confirmed', items: [{ ...row, subject: 'Synthetic', body: { contentType: 'text', content: 'Synthetic body' }, receivedDateTime: '2026-10-04T00:00:00Z', from: { emailAddress: { address: 'sender@example.invalid' } }, toRecipients: [], ccRecipients: [] }] }
    return { exitCode: 0, stdout: JSON.stringify(output) }
  })
  const context = {
    variables: { mailbox: 'owner@example.invalid', 'preview-root': root, 'delivery-mode': 'preview', 'max-messages': '3' }, config: {},
    input: { checkpointRevision: 0, checkpoint: {} as Record<string, unknown>, eventIds: [] },
    network: undefined as undefined | { emit: ReturnType<typeof vi.fn> }, tools: { invoke },
    progress: { commit: vi.fn(async (value: { checkpoint: Record<string, unknown> }) => { context.input.checkpoint = value.checkpoint; context.input.checkpointRevision++ }) },
  }
  return { script, context, messages, root }
}

it('records only observed provider versions as a bounded baseline, then emits changed versions once', async () => {
  const f = await fixture()
  const baseline = await f.script.run(f.context)
  expect(baseline.status).toBe('completed')
  expect(baseline.summary).toContain('Emitted 0 items')
  expect(f.context.input.checkpoint).toMatchObject({ scope: 'latest-three-inbox-and-sent', initial: [{ channel: 'mail.open', id: 'immutable-inbox', version: 'provider-v1' }, { channel: 'mail.sent-raw', id: 'immutable-sent', version: 'provider-v1' }] })
  const emit = vi.fn()
  f.context.network = { emit }
  await f.script.run(f.context)
  expect(emit).not.toHaveBeenCalled()
  f.messages.inbox.changeKey = 'provider-v2'
  await f.script.run(f.context)
  expect(emit).toHaveBeenCalledTimes(1)
  const event = emit.mock.calls[0]![0]
  expect(event).toMatchObject({ channel: 'mail.open', sourceItemId: 'immutable-inbox', sourceVersion: 'provider-v2' })
  expect(JSON.parse(readFileSync(join(f.root, `${event.payload.evidence}.json`), 'utf8'))).toMatchObject({ messageId: 'immutable-inbox', version: 'provider-v2', providerVersionAvailable: true })
  await f.script.run(f.context)
  expect(emit).toHaveBeenCalledTimes(1)
  expect(f.context.tools.invoke.mock.calls.every(([request]) => ['mail', 'workflow'].includes(request.argv[0]!) && ['list', 'read'].includes(request.argv[1]!))).toBe(true)
})

it('refuses missing versions without replacing the checkpoint or fabricating a successful baseline', async () => {
  const f = await fixture()
  f.messages.inbox.changeKey = ''
  await expect(f.script.run(f.context)).rejects.toThrow('stable identity')
  expect(f.context.progress.commit).not.toHaveBeenCalled()
  expect(f.context.input.checkpoint).toEqual({})
})

it('requires an existing reviewed network baseline and refuses standalone overwrites', async () => {
  const f = await fixture()
  f.context.network = { emit: vi.fn() }
  await expect(f.script.run(f.context)).rejects.toThrow('exact bounded provider baseline')
  expect(f.context.tools.invoke).not.toHaveBeenCalled()
  f.context.network = undefined
  await f.script.run(f.context)
  const original = structuredClone(f.context.input.checkpoint)
  await expect(f.script.run(f.context)).rejects.toThrow('cannot overwrite')
  expect(f.context.input.checkpoint).toEqual(original)
})
