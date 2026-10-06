// @vitest-environment node
import { createHash, randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import type { ProgramDefinition } from '../../src/contracts/programs'
import { PodDatabase } from '../../src/worker/storage/database'
import { ResourceRegistry } from '../../src/worker/resources/registry'
import { RemotePrograms } from '../../src/worker/remote/programs'

const stores: PodDatabase[] = []
afterEach(() => { for (const store of stores.splice(0)) { store.close(); rmSync(store.root, { recursive: true, force: true }) } })
function fixture() {
  const store = new PodDatabase(mkdtempSync(join(tmpdir(), 'pods-mobile-programs-'))); stores.push(store)
  const resources = new ResourceRegistry(store, () => {})
  const owner = { issuer: 'https://id.example', subject: 'owner@example.test' }
  const pod = store.createPod({ name: 'Mobile program' })
  const executable = join(store.root, 'synthetic-cli'); const adapterPath = join(store.root, 'synthetic.toml')
  writeFileSync(executable, '#!/bin/sh\necho synthetic\n', { mode: 0o700 }); writeFileSync(adapterPath, 'synthetic descriptor')
  const definition: ProgramDefinition = { name: 'Synthetic CLI', cliId: 'synthetic', executable, executableHash: createHash('sha256').update('#!/bin/sh\necho synthetic\n').digest('hex'), adapterPath, adapterHash: createHash('sha256').update('synthetic descriptor').digest('hex'), entryFiles: [], environment: {}, networkHosts: [] }
  const programs = new RemotePrograms(store, resources)
  const catalogId = programs.offer(owner, definition)
  const review = programs.prepare(owner, pod.id, catalogId)
  let created = 0; let discarded = 0
  const state = { create: async () => { created++; return randomUUID() }, discard: async () => { discarded++ } }
  return { store, resources, owner, pod, definition, programs, catalogId, review, state, counts: () => ({ created, discarded }) }
}
it('assigns only the reviewed offered program with empty grant and private-state bindings', async () => {
  const { programs, owner, pod, review, state, resources, counts } = fixture()
  const result = await programs.decide(owner, pod.id, review.id, 1, review.resourceEpoch, 'approve', state, () => {}, value => value)
  expect(result).toMatchObject({ review: { state: 'approved' } })
  const assignment = resources.list(pod.id).find(item => item.configuration.type === 'program')!
  expect(assignment.configuration.grants).toEqual([])
  expect(assignment.configuration.stateId).toMatch(/^[a-f0-9-]{36}$/)
  expect(counts()).toEqual({ created: 1, discarded: 0 })
  await expect(programs.decide(owner, pod.id, review.id, 1, review.resourceEpoch, 'approve', state, () => {}, value => value)).rejects.toThrow('revision_conflict')
  expect(counts().created).toBe(1)
})
it('denies without creating private state and isolates owners', async () => {
  const { programs, owner, pod, review, state, resources, counts } = fixture()
  const foreign = { ...owner, issuer: 'https://other.example' }
  expect(programs.list(foreign)).toEqual([])
  await expect(programs.decide(foreign, pod.id, review.id, 1, review.resourceEpoch, 'approve', state, () => {}, value => value)).rejects.toThrow('revision_conflict')
  expect(await programs.decide(owner, pod.id, review.id, 1, review.resourceEpoch, 'deny', state, () => {}, value => value)).toMatchObject({ review: { state: 'denied' } })
  expect(resources.list(pod.id)).toEqual([])
  expect(counts().created).toBe(0)
})
it('rejects changed executables, withdrawn offers and authorization loss before assignment', async () => {
  const item = fixture()
  await expect(item.programs.decide(item.owner, item.pod.id, item.review.id, 1, item.review.resourceEpoch, 'approve', item.state, () => { throw new Error('revoked') }, value => value)).rejects.toThrow('revoked')
  expect(item.counts()).toEqual({ created: 1, discarded: 1 })
  expect(item.resources.list(item.pod.id)).toEqual([])
  item.programs.revoke(item.owner, item.catalogId)
  await expect(item.programs.decide(item.owner, item.pod.id, item.review.id, 1, item.review.resourceEpoch, 'approve', item.state, () => {}, value => value)).rejects.toThrow('revision_conflict')
  const changed = fixture()
  writeFileSync(changed.definition.executable, 'Changed program')
  await expect(changed.programs.decide(changed.owner, changed.pod.id, changed.review.id, 1, changed.review.resourceEpoch, 'approve', changed.state, () => {}, value => value)).rejects.toThrow()
  expect(changed.counts().created).toBe(0)
})

it('preserves a concurrent denial while private program state is being created', async () => {
  const item = fixture()
  const state = {
    create: async () => {
      await item.programs.decide(item.owner, item.pod.id, item.review.id, 1, item.review.resourceEpoch, 'deny', item.state, () => {}, value => value)
      return item.state.create()
    },
    discard: item.state.discard,
  }
  await expect(item.programs.decide(item.owner, item.pod.id, item.review.id, 1, item.review.resourceEpoch, 'approve', state, () => {}, value => value)).rejects.toThrow('revision_conflict')
  expect(item.resources.list(item.pod.id)).toEqual([])
  expect(item.programs.reviews(item.owner, item.pod.id)[0]?.state).toBe('denied')
  expect(item.counts()).toEqual({ created: 1, discarded: 1 })
})

it('cleans up private state if the exact review expires before assignment', async () => {
  const item = fixture()
  let now = item.review.expiresAt - 1
  const programs = new RemotePrograms(item.store, item.resources, () => now)
  const state = {
    create: async () => { now = item.review.expiresAt; return item.state.create() },
    discard: item.state.discard,
  }
  await expect(programs.decide(item.owner, item.pod.id, item.review.id, 1, item.review.resourceEpoch, 'approve', state, () => {}, value => value)).rejects.toThrow('revision_conflict')
  expect(item.resources.list(item.pod.id)).toEqual([])
  expect(item.counts()).toEqual({ created: 1, discarded: 1 })
})
