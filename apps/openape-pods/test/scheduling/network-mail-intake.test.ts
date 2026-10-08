// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const account = 'owner@example.invalid'
const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })
interface Mail { id: string, folder: string, internetMessageId: string, from: string, date: string, to: string[], body: string, changeKey: string }
async function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'pods-provider-intake-')); roots.push(root)
  const script = await import(pathToFileURL(resolve('examples/network-mail-intake.mjs')).href)
  const mails: Mail[] = []
  const add = (id: string, minutesAgo: number, overrides: Partial<Mail> = {}) => mails.push({ id, folder: 'Inbox', internetMessageId: `<${id}@example.invalid>`, from: `${id}@sender.invalid`, date: new Date(Date.now() - minutesAgo * 60000).toISOString(), to: [account], body: 'Synthetic body', changeKey: 'provider-v1', ...overrides })
  const invoke = vi.fn(async ({ argv }: { argv: string[] }) => {
    if (argv[0] === 'mail') {
      const folder = argv[argv.indexOf('--folder') + 1]
      const rows = mails.filter(mail => mail.folder === folder).sort((a, b) => b.date.localeCompare(a.date)).map(mail => ({ account, message_id: mail.id, internet_message_id: mail.internetMessageId, date: mail.date, to: mail.to }))
      return { exitCode: 0, stdout: JSON.stringify(rows) }
    }
    const mail = mails.find(item => item.id === argv.at(-1))!
    return { exitCode: 0, stdout: JSON.stringify({ protocol: 'pods-mail/v1', account, operation: 'read', outcome: 'confirmed', items: [{ id: mail.id, changeKey: mail.changeKey, internetMessageId: mail.internetMessageId, subject: `Subject ${mail.id}`, body: { contentType: 'text', content: mail.body }, receivedDateTime: mail.date, from: { emailAddress: { address: mail.from } }, toRecipients: mail.to.map(address => ({ emailAddress: { address } })), ccRecipients: [] }] }) }
  })
  const emit = vi.fn()
  const values = { mailbox: account, 'preview-root': root, 'delivery-mode': 'preview', 'max-messages': '3' }
  const context = {
    variables: {}, config: Object.fromEntries(Object.entries(values).map(([name, value]) => [name, { value, origin: 'composition', kind: 'public' }])),
    input: { checkpointRevision: 1, checkpoint: { version: 1, account, scope: 'latest-three-inbox-and-sent', recordedAt: '2026-10-01T00:00:00Z', initial: [], observed: [] } as Record<string, unknown>, eventIds: [] },
    network: { emit } as undefined | { emit: typeof emit }, tools: { invoke },
    progress: { commit: vi.fn(async (value: { checkpoint: Record<string, unknown> }) => { context.input.checkpoint = value.checkpoint; context.input.checkpointRevision++ }) },
  }
  const run = () => script.run(context)
  return { context, mails, add, emit, run, root }
}
const inboxIds = (emit: ReturnType<typeof vi.fn>) => emit.mock.calls.map(([event]) => event).filter(event => event.channel === 'mail.open').map(event => event.sourceItemId)

it('emits every inbox mail of the window exactly once, oldest first and four per run', async () => {
  const f = await fixture()
  for (let index = 0; index < 30; index++) f.add(`inbox-${index}`, 60 * 24 * 10 - index * 60)
  f.add('too-old', 60 * 24 * 40)
  const first = await f.run()
  expect(first.summary).toContain('emitted 4 new mails; 26 more wait')
  expect(inboxIds(f.emit)).toEqual(['inbox-0', 'inbox-1', 'inbox-2', 'inbox-3'])
  for (let index = 0; index < 10; index++) await f.run()
  expect(inboxIds(f.emit)).toEqual(Array.from({ length: 30 }, (_, index) => `inbox-${index}`))
  expect(f.context.input.checkpoint.observed).toHaveLength(0)
  expect(f.context.tools.invoke.mock.calls.every(([request]) => ['mail', 'workflow'].includes(request.argv[0]!) && ['list', 'read'].includes(request.argv[1]!))).toBe(true)
})

it('protects senders found among all sent recipients', async () => {
  const f = await fixture()
  f.add('sent-old', 60 * 24 * 20, { folder: 'sentitems', to: ['Friend <friend@example.invalid>'] })
  f.add('from-friend', 10, { from: 'friend@example.invalid' })
  f.add('from-stranger', 5)
  await f.run()
  const payload = (id: string) => f.emit.mock.calls.find(([event]) => event.sourceItemId === id)![0].payload
  expect(payload('from-friend').knownContact).toBe(true)
  expect(payload('from-stranger').knownContact).toBe(false)
  expect(f.emit.mock.calls.some(([event]) => event.sourceItemId === 'sent-old')).toBe(false)
})

it('asks again only after a real content change, never after a read or flag', async () => {
  const f = await fixture()
  f.add('newsletter', 10)
  await f.run()
  expect(f.emit).toHaveBeenCalledTimes(1)
  f.mails[0]!.changeKey = 'provider-v2'
  await f.run()
  expect(f.emit).toHaveBeenCalledTimes(1)
  f.mails[0]!.body = 'Corrected body'
  await f.run(); await f.run()
  expect(f.emit).toHaveBeenCalledTimes(2)
  const [first, second] = f.emit.mock.calls.map(([event]) => event)
  expect(second).toMatchObject({ sourceItemId: 'newsletter', sourceVersion: expect.stringMatching(/^content:/) })
  expect(second.sourceVersion).not.toBe(first.sourceVersion)
  expect(JSON.parse(readFileSync(join(f.root, `${second.payload.evidence}.json`), 'utf8'))).toMatchObject({ messageId: 'newsletter', version: second.sourceVersion })
})

it('treats mail recorded before content versions as already received', async () => {
  const f = await fixture()
  f.add('legacy', 10)
  writeFileSync(join(f.root, `${'a'.repeat(64)}.json`), JSON.stringify({ account, messageId: 'legacy', internetMessageId: '<legacy@example.invalid>', version: 'provider-v1' }))
  await f.run()
  expect(f.emit).not.toHaveBeenCalled()
})

it('refuses missing versions or an unreviewed baseline without replacing the checkpoint', async () => {
  const f = await fixture()
  f.add('broken', 5, { changeKey: '' })
  const original = structuredClone(f.context.input.checkpoint)
  await expect(f.run()).rejects.toThrow('stable identity')
  f.context.input.checkpoint = {}
  await expect(f.run()).rejects.toThrow('exact bounded provider baseline')
  expect(f.context.progress.commit).not.toHaveBeenCalled()
  expect(original).toMatchObject({ scope: 'latest-three-inbox-and-sent' })
  f.context.network = undefined
  expect((await f.run()).summary).toContain('nothing was read')
})
