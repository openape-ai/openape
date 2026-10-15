import { afterEach, expect, it, vi } from 'vitest'
import type { InboxMessage, InboxMessagePage, InboxMessagesCommand } from '../../src/contracts/inbox'
import { browserWorkspaceClient } from '../../src/renderer/central/client'
import { messagesReader } from '../../src/renderer/workspace-access'

afterEach(() => { vi.unstubAllGlobals() })
const message = (n: number, archived = false): InboxMessage => ({ id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`, title: `M${n}`, body: 'B', pod: null, runId: null, links: [], created: n, read: null, archived: archived ? n : null })
type List = Extract<InboxMessagesCommand, { type: 'list' }>

// Two pages of inbox (next cursor 10) and one archive page, like the relay returns them.
function host() {
  const calls: List[] = []
  const list = vi.fn(async (command: List): Promise<InboxMessagePage | null> => {
    calls.push(command)
    if (command.archived) return { messages: [message(1, true)], next: null }
    return command.before === 10 ? { messages: [message(9)], next: null } : { messages: [message(12), message(11), message(10)], next: 10 }
  })
  return { calls, list }
}

it('reads the first page of inbox and archive and follows the cursor only when asked for older messages', async () => {
  const { calls, list } = host()
  const reader = messagesReader(list)
  expect(await reader.view(true)).toEqual({ messages: [message(12), message(11), message(10), message(1, true)], more: { inbox: true, archive: false }, error: null })
  await reader.command({ type: 'more', archived: false }, vi.fn())
  expect((await reader.view(false))!.messages.map(item => item.title)).toEqual(['M12', 'M11', 'M10', 'M9', 'M1'])
  expect((await reader.view(false))!.more).toEqual({ inbox: false, archive: false })
  expect(calls.filter(call => call.before === 10)).toHaveLength(1)
})

it('reads again only on its tick or after a change the host applied, also when a poll raced with it', async () => {
  const { list } = host()
  const reader = messagesReader(list)
  await reader.view(true)
  await reader.view(false); await reader.view(false)
  expect(list).toHaveBeenCalledTimes(2)
  // A regular poll during the change must not leave the old state cached until the next tick.
  const apply = vi.fn(async () => { await reader.view(true) })
  await reader.command({ type: 'mark', id: message(12).id, read: true }, apply)
  expect(apply).toHaveBeenCalledExactlyOnceWith({ type: 'mark', id: message(12).id, read: true })
  expect(list).toHaveBeenCalledTimes(4)
  await reader.view(false)
  expect(list).toHaveBeenCalledTimes(6)
  await reader.view(false)
  expect(list).toHaveBeenCalledTimes(6)
})

it('keeps the last list with the error when an update fails and reports no inbox without a registration', async () => {
  const { list } = host()
  const reader = messagesReader(list)
  const first = await reader.view(true)
  list.mockRejectedValueOnce(new Error('Remote service returned 503: unavailable'))
  expect(await reader.view(true)).toEqual({ ...first, error: 'Remote service returned 503: unavailable' })
  // A failed change is not swallowed: the caller shows it and nothing is marked as applied.
  await expect(reader.command({ type: 'mark', id: message(12).id, read: true }, async () => { throw new Error('not_found') })).rejects.toThrow('not_found')
  expect(await messagesReader(async () => null).view(true)).toBeNull()
})

it('sends commands to the owner session endpoint and refuses unsafe message content', async () => {
  const fetch = vi.fn(async (_url: string, _init: RequestInit) => Response.json({ messages: [message(1)], next: null }))
  vi.stubGlobal('fetch', fetch)
  const client = browserWorkspaceClient()
  expect(await client.messages({ type: 'list', archived: true })).toEqual({ messages: [message(1)], next: null })
  expect(fetch.mock.calls[0]![0]).toBe('/api/workspace/v1/messages')
  expect(fetch.mock.calls[0]![1]).toMatchObject({ method: 'POST', credentials: 'same-origin', body: JSON.stringify({ type: 'list', archived: true }) })
  fetch.mockResolvedValueOnce(Response.json({ message: null }))
  expect(await client.messages({ type: 'mark', id: message(1).id, deleted: true })).toBeNull()
  for (const links of [[{ title: 'X', url: 'javascript:alert(1)' }], [{ title: 'X', url: 'http://example.test' }], [{ title: 'X', url: 'https://user:pass@example.test' }]]) {
    fetch.mockResolvedValueOnce(Response.json({ messages: [{ ...message(1), links }], next: null }))
    await expect(client.messages({ type: 'list' })).rejects.toThrow('Invalid inbox message')
  }
  fetch.mockResolvedValueOnce(Response.json({ messages: [{ ...message(1), kind: 'decision' }], next: null }))
  await expect(client.messages({ type: 'list' })).rejects.toThrow('Invalid inbox message')
})
