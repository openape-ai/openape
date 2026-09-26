// @vitest-environment node
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { pathToFileURL } from 'node:url'
import { afterEach, expect, it, vi } from 'vitest'

const roots: string[] = []
afterEach(async () => { vi.unstubAllGlobals(); await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'pods-mail-provider-')); roots.push(root)
  await writeFile(join(root, 'token.json'), JSON.stringify({ Account: { fixture: { username: 'owner@example.test', environment: 'login.microsoftonline.com', home_account_id: 'account' } }, AccessToken: { fixture: { home_account_id: 'account', environment: 'login.microsoftonline.com', target: 'https://graph.microsoft.com/Mail.ReadWrite', expires_on: String(Date.now() / 1000 + 3600), secret: 'synthetic-only' } } }))
  const entry = pathToFileURL(join(process.cwd(), 'examples/microsoft-mail.mjs')).href
  const { microsoftMail } = await import(/* @vite-ignore */ entry) as { microsoftMail: (argv: string[], environment: Record<string, string>) => Promise<Record<string, unknown>> }
  const message = { id: 'immutable-1', changeKey: 'v1', parentFolderId: 'inbox', internetMessageId: '<fixture@example.test>', conversationId: 'thread', from: { emailAddress: { address: 'sender@example.test' } }, subject: 'A completed update', receivedDateTime: '2026-09-26T05:00:00Z', webLink: 'https://outlook.office.com/mail/id/one', body: { content: 'Nothing outstanding.' } }
  const policy = { version: 1, domains: [' Protected.TEST '], addresses: [' KNOWN@example.test '] }
  const sent: { toRecipients: { emailAddress: { address: string } }[], ccRecipients: { emailAddress: { address: string } }[], bccRecipients: { emailAddress: { address: string } }[] }[] = []
  await writeFile(join(root, 'policy.json'), JSON.stringify(policy))
  const fetch = vi.fn(async (url: string | URL, options?: RequestInit) => {
    const address = String(url)
    expect(new Headers(options?.headers).get('Prefer')).toContain('ImmutableId')
    if (address.includes('/mailFolders/sentitems?')) return Response.json({ id: 'sent' })
    if (address.includes('/messages/delta')) expect(new Headers(options?.headers).get('Prefer')).toContain('odata.maxpagesize=500')
    if (address.includes('/messages/delta')) return Response.json({ value: sent, '@odata.deltaLink': 'https://graph.microsoft.com/v1.0/me/mailFolders/sent/messages/delta?$deltatoken=next' })
    if (address.includes('/mailFolders/inbox?')) return Response.json({ id: 'inbox', totalItemCount: 1 })
    if (address.includes('/mailFolders/archive?')) return Response.json({ id: 'archive' })
    if (options?.method === 'POST') { expect(address).toContain('/mailFolders/inbox/messages/immutable-1/move'); expect(JSON.parse(options.body as string)).toEqual({ destinationId: 'archive' }); return Response.json({ ...message, parentFolderId: 'archive', changeKey: 'v2' }, { status: 201 }) }
    if (address.includes('/messages/')) return Response.json(message)
    if (address.includes('/messages?')) return Response.json({ value: [message] })
    throw new Error(`Unexpected provider operation: ${address}`)
  })
  vi.stubGlobal('fetch', fetch)
  return { root, message, fetch, policy, sent, run: (argv: string[]) => microsoftMail([argv[0]!, '--account', 'owner@example.test', ...argv.slice(1)], { O365_CACHE_DIR: root, HOME: root, PODS_MAIL_POLICY: join(root, 'policy.json') }) }
}
it('reads the real companion contract without provider writes and retains immutable metadata', async () => {
  const f = await fixture(); expect(await f.run(['list'])).toMatchObject({ protocol: 'pods-mail-review/v1', total: 1, next: null, messages: [{ id: 'immutable-1', version: 'v1', body: 'Nothing outstanding.' }] })
  expect(f.fetch.mock.calls.every(([, options]) => options?.method === 'GET')).toBe(true)
  expect(await readFile(join(f.root, 'token.json'), 'utf8')).toContain('synthetic-only')
})
it('skips a changed message in the provider preflight without POST', async () => {
  const f = await fixture(); expect(await f.run(['archive', '--message', f.message.id, '--version', 'old', '--folder', 'inbox'])).toMatchObject({ state: 'skipped' })
  expect(f.fetch.mock.calls.every(([, options]) => options?.method === 'GET')).toBe(true)
})
it('moves only from the bound Inbox to the resolved Archive and validates the receipt', async () => {
  const f = await fixture(); expect(await f.run(['archive', '--message', f.message.id, '--version', 'v1', '--folder', 'inbox'])).toMatchObject({ state: 'archived', message: { id: 'immutable-1', version: 'v2', folder: 'archive' } })
  expect(f.fetch.mock.calls.filter(([, options]) => options?.method === 'POST')).toHaveLength(1)
})
it('rejects pagination outside the account and provider scope', async () => {
  const f = await fixture(); await expect(f.run(['list', '--cursor', 'https://evil.example.test/mail'])).rejects.toThrow('cursor')
  expect(f.fetch).toHaveBeenCalledTimes(1)
})
it('follows Microsoft OData Inbox continuation links without broadening the folder scope', async () => {
  const f = await fixture()
  for (const cursor of ['https://graph.microsoft.com/v1.0/me/mailFolders(\'inbox\')/messages?$skip=20', 'https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages?$skip=20']) {
    expect(await f.run(['list', '--cursor', cursor])).toMatchObject({ messages: [{ id: 'immutable-1' }] })
  }
  await expect(f.run(['list', '--cursor', 'https://graph.microsoft.com/v1.0/me/mailFolders(\'sentitems\')/messages'])).rejects.toThrow('cursor')
  expect(f.fetch.mock.calls.every(([, options]) => options?.method === 'GET')).toBe(true)
})

it.each(['toRecipients', 'ccRecipients', 'bccRecipients'] as const)('retains sent %s contacts after removal and skips their archive even with an exact grant', async (field) => {
  const f = await fixture()
  f.sent.push({ toRecipients: [], ccRecipients: [], bccRecipients: [], [field]: [{ emailAddress: { address: 'SENDER@example.test' } }] })
  expect(await f.run(['protection'])).toMatchObject({ ready: true, count: 1 })
  f.sent.splice(0)
  expect(await f.run(['protection'])).toMatchObject({ ready: true, count: 1 })
  expect(await f.run(['archive', '--message', f.message.id, '--version', 'v1', '--folder', 'inbox'])).toMatchObject({ state: 'skipped', reason: expect.stringContaining('Kontakt') })
  expect(f.fetch.mock.calls.every(([, options]) => options?.method === 'GET')).toBe(true)
})
it('refreshes sent contacts at execution and denies an already proposed message to a newly contacted sender', async () => {
  const f = await fixture()
  expect(await f.run(['read', '--message', f.message.id])).toMatchObject({ message: { id: f.message.id } })
  f.sent.push({ toRecipients: [{ emailAddress: { address: f.message.from.emailAddress.address } }], ccRecipients: [], bccRecipients: [] })
  expect(await f.run(['archive', '--message', f.message.id, '--version', 'v1', '--folder', 'inbox'])).toMatchObject({ state: 'skipped' })
  expect(f.fetch.mock.calls.every(([, options]) => options?.method === 'GET')).toBe(true)
})
it.each([['sender@protected.test', true], ['sender@news.protected.test', true], ['sender@unprotected.test', false], ['sender@protected.test.evil.test', false]])('matches domain boundaries for %s', async (address, protectedMail) => {
  const f = await fixture(); f.message.from.emailAddress.address = String(address)
  expect(await f.run(['read', '--message', f.message.id])).toMatchObject({ message: protectedMail ? null : { id: f.message.id } })
})
it('denies a conversation containing another protected participant', async () => {
  const f = await fixture(); Object.assign(f.message, { ccRecipients: [{ emailAddress: { address: 'known@example.test' } }] })
  expect(await f.run(['archive', '--message', f.message.id, '--version', 'v1', '--folder', 'inbox'])).toMatchObject({ state: 'skipped' })
  expect(f.fetch.mock.calls.every(([, options]) => options?.method === 'GET')).toBe(true)
})
it('keeps incomplete Sent Items scans closed and resumes the validated continuation', async () => {
  const f = await fixture(); const original = f.fetch.getMockImplementation()!
  let pages = 0
  f.fetch.mockImplementation(async (url, options) => {
    if (!String(url).includes('/messages/delta')) return original(url, options)
    pages++
    return Response.json({ value: [{ toRecipients: [{ emailAddress: { address: `contact${pages}@example.test` } }], ccRecipients: [], bccRecipients: [] }], [pages < 7 ? '@odata.nextLink' : '@odata.deltaLink']: `https://graph.microsoft.com/v1.0/me/mailFolders('sent')/messages/delta?$skiptoken=${pages}` })
  })
  expect(await f.run(['protection'])).toMatchObject({ ready: false, count: 5 })
  expect(await f.run(['list'])).toMatchObject({ messages: [{ protected: true }] })
  expect(await f.run(['protection'])).toMatchObject({ ready: true, count: 7 })
})
it('rejects foreign sent cursors and incomplete recipient metadata without moving', async () => {
  const f = await fixture(); const original = f.fetch.getMockImplementation()!
  f.fetch.mockImplementation(async (url, options) => String(url).includes('/messages/delta') ? Response.json({ value: [], '@odata.deltaLink': 'https://evil.example.test/mail' }) : original(url, options))
  await expect(f.run(['archive', '--message', f.message.id, '--version', 'v1', '--folder', 'inbox'])).rejects.toThrow('cursor')
  f.fetch.mockImplementation(async (url, options) => String(url).includes('/messages/delta') ? Response.json({ value: [{ toRecipients: [] }], '@odata.deltaLink': 'https://graph.microsoft.com/v1.0/me/mailFolders/sent/messages/delta' }) : original(url, options))
  await expect(f.run(['protection'])).rejects.toThrow('recipient metadata')
  expect(f.fetch.mock.calls.every(([, options]) => options?.method === 'GET')).toBe(true)
})
