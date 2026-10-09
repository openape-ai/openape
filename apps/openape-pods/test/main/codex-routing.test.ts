import { expect, it } from 'vitest'
import { readOnlyAction } from '../../src/main/codex/routing'

// Reads go to the local worker directly; everything else takes the central
// workspace's local execution path. Unknown actions never count as reads.
it('routes inspection and context selection as reads and every mutation route through central', () => {
  for (const action of [{ action: 'runtime' }, { action: 'list' }, { action: 'select', podIds: [] }, { action: 'inspect' }, { action: 'resources', command: { type: 'list' } }, { action: 'workspace', query: { type: 'read' } }, { action: 'workspace', query: { type: 'operation' } }]) expect(readOnlyAction(action)).toBe(true)
  for (const action of [{ action: 'run' }, { action: 'activate' }, { action: 'revise' }, { action: 'resources', command: { type: 'removeVariable' } }, { action: 'scripts', command: { type: 'prepareDependencies' } }, { action: 'workspace', query: { type: 'submit' } }, { action: 'mcpAccess', mode: 'write' }, { action: 'future-action' }, { action: 1 }]) expect(readOnlyAction(action)).toBe(false)
})

it('classifies bounded network reads and validates network actions before routing', () => {
  const id = '00000000-0000-4000-8000-000000000001'
  for (const command of [{ type: 'list' }, { type: 'detail', id, revision: 1 }, { type: 'legacyItems', id, revision: 1, after: null }]) expect(readOnlyAction({ action: 'networks', command })).toBe(true)
  for (const command of [{ type: 'pause', id, revision: 1 }, { type: 'preview', id, revision: 1, podIds: [id], pausedPodIds: [id], budget: 1 }, { type: 'process', id, revision: 1, previewId: id }]) expect(readOnlyAction({ action: 'networks', command })).toBe(false)
  expect(() => readOnlyAction({ action: 'networks', command: { type: 'list' }, ownerOperation: true })).toThrow('fields')
  expect(() => readOnlyAction({ action: 'networks', command: { type: 'activate', id, revision: 1 } })).toThrow('desktop')
})
