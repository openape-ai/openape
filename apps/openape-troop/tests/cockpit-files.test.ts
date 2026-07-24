import { describe, expect, it, vi } from 'vitest'

// file-store/chat-store hit the real DB layer; tests run them against an
// in-memory LibSQL with the same DDL as 02.database.ts. Push is a no-op here.
vi.mock('../server/database/drizzle', async () => {
  const { createClient } = await import('@libsql/client')
  const { drizzle } = await import('drizzle-orm/libsql')
  const schema = await import('../server/database/schema')
  const client = createClient({ url: ':memory:' })
  await client.execute(`CREATE TABLE organizations (id TEXT PRIMARY KEY, owner_email TEXT NOT NULL, name TEXT NOT NULL, vision_md TEXT NOT NULL DEFAULT '', budget_monthly_eur INTEGER NOT NULL DEFAULT 0, vars TEXT NOT NULL DEFAULT '{}', created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)`)
  await client.execute(`CREATE TABLE cockpit_files (id TEXT PRIMARY KEY, owner_email TEXT NOT NULL, org_id TEXT NOT NULL, name TEXT NOT NULL, mime TEXT NOT NULL, size INTEGER NOT NULL, bytes BLOB NOT NULL, created_at INTEGER NOT NULL)`)
  await client.execute(`CREATE TABLE cockpit_chat_messages (id TEXT PRIMARY KEY, owner_email TEXT NOT NULL, org_id TEXT NOT NULL, role TEXT NOT NULL, content TEXT NOT NULL, meta TEXT, files TEXT, created_at INTEGER NOT NULL)`)
  const db = drizzle(client, { schema })
  return { useDb: () => db }
})
vi.mock('../server/utils/cockpit/push', () => ({ pushToOwner: vi.fn(async () => {}) }))

const { loadFile, MAX_FILE_BYTES, resolveRefs, saveFile, sweepOrphanFiles } = await import('../server/utils/cockpit/file-store')
const { saveChatMessage } = await import('../server/utils/cockpit/chat-store')
const { pushToOwner } = await import('../server/utils/cockpit/push')
const { useDb } = await import('../server/database/drizzle')
const { organizations } = await import('../server/database/schema')

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]), Buffer.from('rest-of-png')])
const PDF = Buffer.from('%PDF-1.7 minimal')

describe('cockpit file store', () => {
  it('round-trips bytes owner-bound', async () => {
    const ref = await saveFile('files1@x', 'org', 'bild.png', 'image/png', PNG)
    expect('id' in ref).toBe(true)
    const row = await loadFile('files1@x', (ref as { id: string }).id)
    expect(Buffer.from(row!.bytes).equals(PNG)).toBe(true)
    expect(await loadFile('fremd@x', (ref as { id: string }).id)).toBeUndefined() // foreign owner: invisible
  })

  it('rejects content that does not match the declared type (magic bytes)', async () => {
    const lie = await saveFile('files2@x', 'org', 'fake.pdf', 'application/pdf', PNG)
    expect(lie).toEqual({ error: 'file content does not match its declared type', status: 400 })
  })

  it('rejects disallowed mimes, oversize and empty files', async () => {
    expect(await saveFile('files3@x', 'org', 'x.svg', 'image/svg+xml', Buffer.from('<svg/>'))).toMatchObject({ status: 400 })
    expect(await saveFile('files3@x', 'org', 'big.png', 'image/png', Buffer.alloc(MAX_FILE_BYTES + 1))).toMatchObject({ status: 413 })
    expect(await saveFile('files3@x', 'org', 'leer.png', 'image/png', Buffer.alloc(0))).toMatchObject({ status: 400 })
  })

  it('resolveRefs validates ownership and the per-message cap', async () => {
    const a = await saveFile('files4@x', 'org', 'a.pdf', 'application/pdf', PDF) as { id: string }
    expect(await resolveRefs('files4@x', [a.id])).toEqual([{ id: a.id, mime: 'application/pdf', name: 'a.pdf' }])
    expect(await resolveRefs('fremd@x', [a.id])).toBeNull()
    expect(await resolveRefs('files4@x', [a.id, a.id, a.id, a.id, a.id])).toBeNull() // > 4
  })

  it('sweep drops old unreferenced files, keeps referenced ones', async () => {
    const keep = await saveFile('files5@x', 'org', 'keep.png', 'image/png', PNG) as { id: string, mime: string, name: string }
    const drop = await saveFile('files5@x', 'org', 'drop.png', 'image/png', PNG) as { id: string }
    await saveChatMessage('org', 'files5@x', 'user', 'mit Anhang', undefined, [keep])
    await sweepOrphanFiles(0, Date.now() + 1000) // everything is "old" — only the reference protects
    expect(await loadFile('files5@x', keep.id)).toBeDefined()
    expect(await loadFile('files5@x', drop.id)).toBeUndefined()
  })

  it('includes the owning company name in assistant push notifications', async () => {
    await useDb().insert(organizations).values({
      id: 'org-notify', ownerEmail: 'notify@x', name: 'Acme Nord',
      visionMd: '', budgetMonthlyEur: 0, vars: {}, createdAt: Date.now(), updatedAt: Date.now(),
    })

    await saveChatMessage('org-notify', 'notify@x', 'assistant', 'Die Prüfung ist abgeschlossen.')

    expect(pushToOwner).toHaveBeenCalledWith('notify@x', {
      title: 'Acme Nord',
      body: 'Troop-Chat · Die Prüfung ist abgeschlossen.',
      url: '/chat',
    })
  })
})
