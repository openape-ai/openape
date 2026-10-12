// @vitest-environment node
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, expect, it } from 'vitest'
import { parseCommand } from '../../src/contracts/control'
import { normalizeTags } from '../../src/contracts/tags'
import { parseCentralCommand } from '../../src/contracts/central'
import { PodDatabase } from '../../src/worker/storage/database'
import { ItemTagStore } from '../../src/worker/workspace/item-tags'

const root = mkdtempSync(join(tmpdir(), 'pods-item-tags-'))
const store = new PodDatabase(root)
afterAll(() => { store.close(); rmSync(root, { recursive: true, force: true }) })
const pod = store.createPod({ name: 'Mail sync' })
const tags = new ItemTagStore(store)
const tag = (id: string, revision: number, list: string[]) => tags.execute(parseCommand({ type: 'tag', id, revision, tags: list }) as { type: 'tag', id: string, revision: number, tags: string[] })

it('normalizes free tags and refuses invalid ones', () => {
  expect(normalizeTags([' Delta Mind ', 'mail', 'MAIL', 'persönlich'])).toEqual(['delta-mind', 'mail', 'persönlich'])
  expect(() => normalizeTags(['a/b'])).toThrow('Invalid tag')
  expect(() => normalizeTags(['-mail'])).toThrow('Invalid tag')
  expect(() => normalizeTags(['x'.repeat(33)])).toThrow('Invalid tag')
  expect(() => normalizeTags(Array.from({ length: 9 }, (_, index) => `t${index}`))).toThrow('Too many tags')
  expect(parseCentralCommand({ channel: 'workspace', body: { type: 'tag', id: pod.id, revision: 0, tags: ['Mail'] } }).body).toEqual({ type: 'tag', id: pod.id, revision: 0, tags: ['mail'] })
  expect(() => parseCommand({ type: 'renameNetwork', id: pod.id, name: 'Mail' })).toThrow('Unsupported workspace command')
})

it('stores own tags of a Pod with a revision', () => {
  tag(pod.id, 0, ['delta-mind', 'mail'])
  expect(tags.view()).toEqual([{ id: pod.id, tags: ['delta-mind', 'mail'], revision: 1 }])
  expect(tags.podTags(pod.id)).toEqual(['delta-mind', 'mail'])
  expect(() => tag(pod.id, 0, ['other'])).toThrow('Tags changed')
  tag(pod.id, 1, [])
  expect(tags.view()).toEqual([])
  expect(() => tag('00000000-0000-4000-8000-000000000000', 0, ['x'])).toThrow('Pod not found')
})
