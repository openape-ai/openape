// @vitest-environment node
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, expect, it } from 'vitest'
import { parseCommand } from '../../src/contracts/control'
import { normalizeTags } from '../../src/contracts/tags'
import { parseCentralCommand } from '../../src/contracts/central'
import { PodDatabase } from '../../src/worker/storage/database'
import { ItemTagStore, renameNetwork } from '../../src/worker/workspace/item-tags'
import { seedNetwork } from '../storage/network-fixture'

const root = mkdtempSync(join(tmpdir(), 'pods-item-tags-'))
const store = new PodDatabase(root)
afterAll(() => { store.close(); rmSync(root, { recursive: true, force: true }) })
const seeded = seedNetwork(store)
const tags = new ItemTagStore(store)
const tag = (id: string, revision: number, list: string[]) => tags.execute(parseCommand({ type: 'tag', id, revision, tags: list }) as { type: 'tag', id: string, revision: number, tags: string[] })

it('normalizes free tags and refuses invalid ones', () => {
  expect(normalizeTags([' Delta Mind ', 'mail', 'MAIL', 'persönlich'])).toEqual(['delta-mind', 'mail', 'persönlich'])
  expect(() => normalizeTags(['a/b'])).toThrow('Invalid tag')
  expect(() => normalizeTags(['-mail'])).toThrow('Invalid tag')
  expect(() => normalizeTags(['x'.repeat(33)])).toThrow('Invalid tag')
  expect(() => normalizeTags(Array.from({ length: 9 }, (_, index) => `t${index}`))).toThrow('Too many tags')
  expect(parseCentralCommand({ channel: 'workspace', body: { type: 'tag', id: seeded.networkId, revision: 0, tags: ['Mail'] } }).body).toEqual({ type: 'tag', id: seeded.networkId, revision: 0, tags: ['mail'] })
})

it('stores own tags with a revision and shows network tags as inherited on members without copying them', () => {
  tag(seeded.networkId, 0, ['delta-mind', 'mail'])
  tag(seeded.pod.id, 0, ['intake'])
  expect(tags.view()).toEqual(expect.arrayContaining([
    { id: seeded.networkId, tags: ['delta-mind', 'mail'], revision: 1, inherited: [] },
    { id: seeded.pod.id, tags: ['intake'], revision: 1, inherited: ['delta-mind', 'mail'] },
  ]))
  expect(store.db.prepare('SELECT tags FROM item_tags WHERE id=?').get(seeded.pod.id)!.tags).toBe('["intake"]')
  expect(() => tag(seeded.pod.id, 0, ['other'])).toThrow('Tags changed')
  tag(seeded.pod.id, 1, [])
  expect(tags.view()).toContainEqual({ id: seeded.pod.id, tags: [], revision: 0, inherited: ['delta-mind', 'mail'] })
  expect(() => tag('00000000-0000-4000-8000-000000000000', 0, ['x'])).toThrow('Pod or network not found')
})

it('renames a network without a new revision', () => {
  const before = store.db.prepare('SELECT revision FROM networks WHERE id=?').get(seeded.networkId)
  renameNetwork(store, parseCommand({ type: 'renameNetwork', id: seeded.networkId, name: '  Mail ' }) as { type: 'renameNetwork', id: string, name: string })
  expect(store.db.prepare('SELECT name,revision FROM networks WHERE id=?').get(seeded.networkId)).toEqual({ name: 'Mail', ...before })
  expect(() => renameNetwork(store, { type: 'renameNetwork', id: '00000000-0000-4000-8000-000000000000', name: 'X' })).toThrow('Network not found')
})
