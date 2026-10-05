// @vitest-environment node
import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, expect, it } from 'vitest'
import { parseCommand, parseWorkspace } from '../../src/contracts/control'
import { PodDatabase, schemaVersion } from '../../src/worker/storage/database'
import { CollectionDescriptions } from '../../src/worker/workspace/collection-descriptions'
import { seedNetwork } from '../storage/network-fixture'

const root = mkdtempSync(join(tmpdir(), 'pods-collection-descriptions-'))
let store = new PodDatabase(root)
afterEach(() => { store.db.prepare('DELETE FROM collection_descriptions').run() })
afterAll(() => { store.close(); rmSync(root, { recursive: true, force: true }) })
function workflow(): string {
  const id = randomUUID()
  store.db.prepare('INSERT INTO workflows(id,revision,name,nodes) VALUES(?,1,\'Morning briefing\',\'[]\')').run(id)
  return id
}
const describe = (id: string, revision: number, text: string) => new CollectionDescriptions(store).execute({ type: 'describeCollection', id, revision, text })

it('saves, replaces and clears the description of a workflow', () => {
  const id = workflow()
  describe(id, 0, 'Collects calendar, mail and open issues every morning.')
  expect(new CollectionDescriptions(store).view()).toEqual([{ id, text: 'Collects calendar, mail and open issues every morning.', revision: 1 }])
  describe(id, 1, 'Sends one morning briefing by Telegram.')
  expect(new CollectionDescriptions(store).view()).toEqual([{ id, text: 'Sends one morning briefing by Telegram.', revision: 2 }])
  describe(id, 2, '   ')
  expect(new CollectionDescriptions(store).view()).toEqual([])
})

it('describes a persistent network without changing the network revision', () => {
  const { networkId } = seedNetwork(store)
  const before = store.db.prepare('SELECT revision FROM networks WHERE id=?').get(networkId)
  describe(networkId, 0, 'Sorts incoming mail and asks before archiving.')
  expect(new CollectionDescriptions(store).view()).toEqual([{ id: networkId, text: 'Sorts incoming mail and asks before archiving.', revision: 1 }])
  expect(store.db.prepare('SELECT revision FROM networks WHERE id=?').get(networkId)).toEqual(before)
})

it('refuses a stale revision and an unknown network or workflow', () => {
  const id = workflow()
  describe(id, 0, 'First text.')
  expect(() => describe(id, 0, 'Concurrent text.')).toThrow('Description changed; reload before saving')
  expect(() => describe(randomUUID(), 0, 'Nothing to describe.')).toThrow('Network or workflow not found')
  expect(new CollectionDescriptions(store).view()).toEqual([{ id, text: 'First text.', revision: 1 }])
})

it('does not list the description of a removed workflow', () => {
  const id = workflow()
  describe(id, 0, 'Temporary.')
  store.db.prepare('DELETE FROM workflows WHERE id=?').run(id)
  expect(new CollectionDescriptions(store).view()).toEqual([])
})

it('validates the command and the listed descriptions', () => {
  const id = randomUUID()
  expect(parseCommand({ type: 'describeCollection', id, revision: 0, text: 'Purpose' })).toEqual({ type: 'describeCollection', id, revision: 0, text: 'Purpose' })
  expect(() => parseCommand({ type: 'describeCollection', id, revision: 0, text: 'x'.repeat(1001) })).toThrow('Invalid description')
  expect(() => parseCommand({ type: 'describeCollection', id: 'not-an-id', revision: 0, text: 'Purpose' })).toThrow('Invalid description')
  expect(() => parseCommand({ type: 'describeCollection', id, revision: 0, text: 'Purpose', name: 'extra' })).toThrow('Unsupported workspace command')
  const state = (descriptions: unknown) => ({ pods: [], organization: { revision: 1, groups: [] }, descriptions })
  expect(parseWorkspace(state([{ id, text: 'Purpose', revision: 1 }])).descriptions).toEqual([{ id, text: 'Purpose', revision: 1 }])
  expect(() => parseWorkspace(state([{ id, text: 'x'.repeat(1001), revision: 1 }]))).toThrow('Invalid workspace descriptions')
  expect(() => parseWorkspace(state('none'))).toThrow('Invalid workspace descriptions')
})

it('adds description storage to an existing schema-37 profile without touching its data', () => {
  const id = workflow()
  store.db.exec('DROP TABLE collection_descriptions; PRAGMA user_version=37')
  store.close(); store = new PodDatabase(root)
  expect(store.db.prepare('PRAGMA user_version').get()?.user_version).toBe(schemaVersion)
  expect(store.db.prepare('SELECT name FROM workflows WHERE id=?').get(id)?.name).toBe('Morning briefing')
  expect(new CollectionDescriptions(store).view()).toEqual([])
})
