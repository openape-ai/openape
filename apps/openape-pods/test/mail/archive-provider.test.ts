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
  const fetch = vi.fn(async (url: string | URL, options?: RequestInit) => {
    const address = String(url)
    expect(new Headers(options?.headers).get('Prefer')).toContain('ImmutableId')
    if (address.includes('/mailFolders/inbox?')) return Response.json({ id: 'inbox', totalItemCount: 1 })
    if (address.includes('/mailFolders/archive?')) return Response.json({ id: 'archive' })
    if (options?.method === 'POST') { expect(address).toContain('/mailFolders/inbox/messages/immutable-1/move'); expect(JSON.parse(options.body as string)).toEqual({ destinationId: 'archive' }); return Response.json({ ...message, parentFolderId: 'archive', changeKey: 'v2' }, { status: 201 }) }
    if (address.includes('/messages/')) return Response.json(message)
    if (address.includes('/messages?')) return Response.json({ value: [message] })
    throw new Error(`Unexpected provider operation: ${address}`)
  })
  vi.stubGlobal('fetch', fetch)
  return { root, message, fetch, run: (argv: string[]) => microsoftMail([argv[0]!, '--account', 'owner@example.test', ...argv.slice(1)], { O365_CACHE_DIR: root, HOME: root }) }
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
