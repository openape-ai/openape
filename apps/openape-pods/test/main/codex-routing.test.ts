import { expect, it } from 'vitest'
import { readOnlyAction } from '../../src/main/codex/routing'

// Reads go to the local worker directly; everything else takes the central
// workspace's local execution path. Unknown actions never count as reads.
it('routes inspection and context selection as reads and every mutation route through central', () => {
  for (const action of [{ action: 'runtime' }, { action: 'list' }, { action: 'select', podIds: [] }, { action: 'inspect' }, { action: 'resources', command: { type: 'list' } }, { action: 'workspace', query: { type: 'read' } }, { action: 'workspace', query: { type: 'operation' } }]) expect(readOnlyAction(action)).toBe(true)
  for (const action of [{ action: 'run' }, { action: 'activate' }, { action: 'revise' }, { action: 'resources', command: { type: 'removeVariable' } }, { action: 'scripts', command: { type: 'prepareDependencies' } }, { action: 'workspace', query: { type: 'submit' } }, { action: 'mcpAccess', mode: 'write' }, { action: 'future-action' }, { action: 1 }]) expect(readOnlyAction(action)).toBe(false)
})

it('routes domain reads to the worker and every domain change through central', () => {
  for (const type of ['list', 'entries', 'work']) expect(readOnlyAction({ action: 'domain', command: { type } })).toBe(true)
  for (const type of ['define', 'setReaders', 'assignWriter', 'set', 'delete', 'reprocess', 'release', 'answer', 'resolveApproval', 'resolveEffect']) expect(readOnlyAction({ action: 'domain', command: { type } })).toBe(false)
  expect(readOnlyAction({ action: 'networks', command: { type: 'list' } })).toBe(false)
})
