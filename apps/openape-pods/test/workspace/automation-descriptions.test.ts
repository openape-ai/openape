// @vitest-environment node
import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, expect, it } from 'vitest'
import { parseCommand, parseWorkspace } from '../../src/contracts/control'
import { PodDatabase } from '../../src/worker/storage/database'
import { AutomationDescriptions } from '../../src/worker/workspace/automation-descriptions'
import { seedNetwork } from '../storage/network-fixture'

const root = mkdtempSync(join(tmpdir(), 'pods-automation-descriptions-'))
const store = new PodDatabase(root)
afterEach(() => { store.db.prepare('DELETE FROM automation_descriptions').run() })
afterAll(() => { store.close(); rmSync(root, { recursive: true, force: true }) })
let seeded: string | undefined
const network = (): string => seeded ??= seedNetwork(store).networkId
const describe = (id: string, revision: number, text: string) => new AutomationDescriptions(store).execute({ type: 'describeAutomation', id, revision, text })

it('saves, replaces and clears the description of a network', () => {
  const id = network()
  describe(id, 0, 'Collects calendar, mail and open issues every morning.')
  expect(new AutomationDescriptions(store).view()).toEqual([{ id, text: 'Collects calendar, mail and open issues every morning.', revision: 1 }])
  describe(id, 1, 'Sends one morning briefing by Telegram.')
  expect(new AutomationDescriptions(store).view()).toEqual([{ id, text: 'Sends one morning briefing by Telegram.', revision: 2 }])
  describe(id, 2, '   ')
  expect(new AutomationDescriptions(store).view()).toEqual([])
})

it('describes a persistent network without changing the network revision', () => {
  const networkId = network()
  const before = store.db.prepare('SELECT revision FROM networks WHERE id=?').get(networkId)
  describe(networkId, 0, 'Sorts incoming mail and asks before archiving.')
  expect(new AutomationDescriptions(store).view()).toEqual([{ id: networkId, text: 'Sorts incoming mail and asks before archiving.', revision: 1 }])
  expect(store.db.prepare('SELECT revision FROM networks WHERE id=?').get(networkId)).toEqual(before)
})

it('refuses a stale revision and an unknown network', () => {
  const id = network()
  describe(id, 0, 'First text.')
  expect(() => describe(id, 0, 'Concurrent text.')).toThrow('Description changed; reload before saving')
  expect(() => describe(randomUUID(), 0, 'Nothing to describe.')).toThrow('Network not found')
  expect(new AutomationDescriptions(store).view()).toEqual([{ id, text: 'First text.', revision: 1 }])
})

it('validates the command and the listed descriptions', () => {
  const id = randomUUID()
  expect(parseCommand({ type: 'describeAutomation', id, revision: 0, text: 'Purpose' })).toEqual({ type: 'describeAutomation', id, revision: 0, text: 'Purpose' })
  expect(() => parseCommand({ type: 'describeAutomation', id, revision: 0, text: 'x'.repeat(1001) })).toThrow('Invalid description')
  expect(() => parseCommand({ type: 'describeAutomation', id: 'not-an-id', revision: 0, text: 'Purpose' })).toThrow('Invalid description')
  expect(() => parseCommand({ type: 'describeAutomation', id, revision: 0, text: 'Purpose', name: 'extra' })).toThrow('Unsupported workspace command')
  const state = (descriptions: unknown) => ({ pods: [], organization: { revision: 1, groups: [] }, descriptions })
  expect(parseWorkspace(state([{ id, text: 'Purpose', revision: 1 }])).descriptions).toEqual([{ id, text: 'Purpose', revision: 1 }])
  expect(() => parseWorkspace(state([{ id, text: 'x'.repeat(1001), revision: 1 }]))).toThrow('Invalid workspace descriptions')
  expect(() => parseWorkspace(state('none'))).toThrow('Invalid workspace descriptions')
})
