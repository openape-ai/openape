import { createClient } from '@libsql/client'
import { drizzle } from 'drizzle-orm/libsql'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { migrateStoredGrantSummaries } from '../server/utils/grant-summary-migration'

let directory: string
let client: ReturnType<typeof createClient>

const base = { requester: 'agent@example.test', target_host: 'pods:demo', audience: 'shapes', grant_type: 'once', command: ['git', 'push'] }
const fixtures: Record<string, unknown> = {
  'multi-line': { ...base, summary: { text: '\nRebase PR 395 onto main\nTwo commits\r\nNo conflicts\n', link: 'https://repos.example.test/pulls/395' } },
  'long-first-line': { ...base, summary: { text: `${'Archive the newsletter '.repeat(8)}now\nsecond` } },
  'hidden-characters': { ...base, summary: { text: 'Pay\u202E now\ttoday', link: 'javascript:alert(1)' } },
  'blank': { ...base, summary: { text: ' \n ' } },
  'current': { ...base, summary: { title: 'Already migrated', origin: 'Pod' } },
  'none': base,
}

async function requestOf(id: string): Promise<Record<string, unknown>> {
  return JSON.parse(String((await client.execute({ sql: 'SELECT request FROM grants WHERE id=?', args: [id] })).rows[0]!.request))
}

beforeEach(async () => {
  directory = mkdtempSync(join(tmpdir(), 'idp-summary-'))
  client = createClient({ url: `file:${join(directory, 'idp.sqlite')}` })
  await client.execute('CREATE TABLE grants (id TEXT PRIMARY KEY, status TEXT NOT NULL, type TEXT, requester TEXT NOT NULL, target_host TEXT NOT NULL, audience TEXT NOT NULL, grant_type TEXT NOT NULL, request TEXT NOT NULL, created_at INTEGER NOT NULL)')
  const rows = [...Object.entries(fixtures).map(([id, request]) => [id, JSON.stringify(request)]), ['malformed', '{not json']]
  for (const [id, request] of rows) await client.execute({ sql: 'INSERT INTO grants(id,status,requester,target_host,audience,grant_type,request,created_at) VALUES(?,\'approved\',\'agent@example.test\',\'pods:demo\',\'shapes\',\'once\',?,1)', args: [id!, request!] })
})

afterEach(() => {
  client.close()
  rmSync(directory, { recursive: true, force: true })
})

it('converts stored summary text to title and description, once', async () => {
  const database = drizzle(client)
  expect(await migrateStoredGrantSummaries(database)).toBe(4)

  expect(await requestOf('multi-line')).toEqual({ ...base, summary: { title: 'Rebase PR 395 onto main', description: 'Two commits\nNo conflicts', link: 'https://repos.example.test/pulls/395' } })
  const long = (await requestOf('long-first-line')).summary as { title: string, description: string }
  expect([...long.title].length).toBeLessThanOrEqual(120)
  expect(long.title.endsWith('…')).toBe(true)
  expect(long.description).toBe(`${'Archive the newsletter '.repeat(8)}now\nsecond`)
  expect(await requestOf('hidden-characters')).toEqual({ ...base, summary: { title: 'Pay now today', link: 'javascript:alert(1)' } })
  expect(await requestOf('blank')).toEqual(base)
  expect(await requestOf('current')).toEqual(fixtures.current)
  expect(await requestOf('none')).toEqual(base)
  expect((await client.execute('SELECT request FROM grants WHERE id=\'malformed\'')).rows[0]!.request).toBe('{not json')

  expect(await migrateStoredGrantSummaries(database)).toBe(0)
  expect((await client.execute('SELECT count(*) AS n FROM grants WHERE json_valid(request) AND json_extract(request, \'$.summary.text\') IS NOT NULL')).rows[0]!.n).toBe(0)
})
