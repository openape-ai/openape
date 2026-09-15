// @vitest-environment node
import { mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { afterEach, expect, it } from 'vitest'
import { PodDatabase } from '../../src/worker/storage/database'
import { PodGroups } from '../../src/worker/workspace/groups'
import { parseCommand, parseWorkspace } from '../../src/contracts/control'
import type { GroupAction } from '../../src/contracts/groups'

const roots: string[] = []; const stores: PodDatabase[] = []
afterEach(() => { for (const store of stores) store.close(); stores.length = 0; for (const root of roots) rmSync(root, { recursive: true, force: true }); roots.length = 0 })
function fixture() { const root = mkdtempSync(join(tmpdir(), 'pods-groups-')); roots.push(root); const store = new PodDatabase(root); stores.push(store); return store }
function apply(groups: PodGroups, action: GroupAction) { groups.execute({ type: 'organize', revision: groups.view().revision, ...action }) }
it('migrates an existing profile without changing pods and persists groups across reopening', () => {
  let store = fixture(); const pod = store.createPod({ name: 'Orders' })
  store.db.exec('ALTER TABLE pods DROP COLUMN metadata_revision; DROP TABLE pod_chat_origins; DROP TABLE master_creations; DROP TABLE pod_descriptions; DROP TABLE summary_domains; DROP TABLE program_leases; DROP TABLE master_message_scopes; DROP TABLE master_contexts; DROP TABLE pod_variables; DROP TABLE script_credential_approvals; DROP TABLE pod_memberships; DROP TABLE pod_groups; DROP TABLE pod_organization; PRAGMA user_version=10;')
  store.close(); stores.pop(); store = new PodDatabase(store.root); stores.push(store)
  const groups = new PodGroups(store); expect(groups.view()).toEqual({ revision: 1, groups: [] }); expect(store.getPod(pod.id)).toEqual(pod)
  expect(readdirSync(store.root).some(name => name.startsWith('before-v10-'))).toBe(true)
  apply(groups, { action: 'create', name: '  Clients  ' }); const id = groups.view().groups[0]!.id
  apply(groups, { action: 'move', podId: pod.id, groupId: id }); apply(groups, { action: 'rename', id, name: 'Work' }); apply(groups, { action: 'collapse', id, collapsed: true })
  const state = groups.view(); store.close(); stores.pop(); store = new PodDatabase(store.root); stores.push(store)
  expect(new PodGroups(store).view()).toEqual(state); expect(store.getPod(pod.id)).toEqual(pod)
  expect(parseWorkspace({ pods: store.listPods(), organization: state }).organization.groups[0]).toMatchObject({ name: 'Work', collapsed: true, podIds: [pod.id] })
})
it('moves one membership, retains pods on group removal and removes membership on pod deletion', () => {
  const store = fixture(); const groups = new PodGroups(store); const pod = store.createPod({ name: 'Orders' })
  apply(groups, { action: 'create', name: 'Clients' }); apply(groups, { action: 'create', name: 'Personal' }); const [first, second] = groups.view().groups
  apply(groups, { action: 'move', podId: pod.id, groupId: first!.id }); apply(groups, { action: 'move', podId: pod.id, groupId: second!.id })
  expect(groups.view().groups.map(group => group.podIds)).toEqual([[], [pod.id]])
  apply(groups, { action: 'remove', id: second!.id }); expect(store.getPod(pod.id)).toEqual(pod); expect(groups.view().groups[0]!.podIds).toEqual([])
  apply(groups, { action: 'move', podId: pod.id, groupId: first!.id }); apply(groups, { action: 'move', podId: pod.id, groupId: null }); expect(groups.view().groups[0]!.podIds).toEqual([])
  apply(groups, { action: 'move', podId: pod.id, groupId: first!.id })
  store.db.prepare('DELETE FROM assignments WHERE pod_id=?').run(pod.id); store.db.prepare('DELETE FROM checkpoints WHERE pod_id=?').run(pod.id); store.db.prepare('DELETE FROM pods WHERE id=?').run(pod.id)
  expect(groups.view().groups[0]!.podIds).toEqual([])
})
it('rejects stale edits, unknown targets, duplicate names and excessive authority atomically', () => {
  const store = fixture(); const groups = new PodGroups(store); apply(groups, { action: 'create', name: 'Work' }); const prior = groups.view()
  expect(() => groups.execute({ type: 'organize', revision: 1, action: 'create', name: 'Stale' })).toThrow('Groups changed')
  expect(() => apply(groups, { action: 'create', name: 'work' })).toThrow('already exists')
  expect(() => apply(groups, { action: 'rename', id: randomUUID(), name: 'Other' })).toThrow('no longer exists')
  const pod = store.createPod({ name: 'Pod' })
  expect(() => apply(groups, { action: 'move', podId: pod.id, groupId: randomUUID() })).toThrow('no longer exists')
  expect(() => apply(groups, { action: 'move', podId: randomUUID(), groupId: null })).toThrow('Pod not found')
  expect(groups.view()).toEqual(prior)
  for (const name of ['', ' ', 'Ungrouped', '\ninvalid', 'x'.repeat(101)]) expect(() => parseCommand({ type: 'organize', revision: 1, action: 'create', name })).toThrow()
  expect(() => parseCommand({ type: 'organize', revision: 1, action: 'move', podId: pod.id, groupId: null, permissions: ['all'] })).toThrow()
  expect(() => parseCommand({ type: 'organize', revision: 1, action: '__proto__' })).toThrow()
  expect(() => parseWorkspace({ pods: [pod], organization: { revision: 1, groups: [{ id: randomUUID(), name: 'Work', collapsed: false, podIds: [pod.id, pod.id] }] } })).toThrow('membership')
})
it('enforces the group limit without partially writing a group', () => {
  const groups = new PodGroups(fixture())
  for (let index = 0; index < 50; index++) apply(groups, { action: 'create', name: `Group ${index}` })
  const prior = groups.view(); expect(() => apply(groups, { action: 'create', name: 'Overflow' })).toThrow('50 groups'); expect(groups.view()).toEqual(prior)
})
