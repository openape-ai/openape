// @vitest-environment node
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { PodDatabase } from '../../src/worker/storage/database'
import { PodVariables } from '../../src/worker/resources/variables'
import { parseResourceCommand } from '../../src/contracts/resources'

it('persists pod-scoped plain values, rejects stale changes and preserves captured input', () => {
  const root = mkdtempSync(join(tmpdir(), 'pods-variables-')); let store = new PodDatabase(root)
  try {
    const first = store.createPod({ name: 'First' }); const second = store.createPod({ name: 'Second' })
    const variables = new PodVariables(store)
    variables.save(first.id, 'topic', 'Orders', 0)
    const captured = variables.values(first.id)
    expect(variables.list(second.id)).toEqual([])
    expect(() => variables.save(first.id, 'topic', 'Stale', 0)).toThrow('changed')
    variables.save(first.id, 'topic', 'Updated', 1)
    expect(captured).toEqual({ topic: 'Orders' })
    expect(() => variables.remove(first.id, 'topic', 1)).toThrow('changed')
    store.close(); store = new PodDatabase(root)
    expect(new PodVariables(store).values(first.id)).toEqual({ topic: 'Updated' })
    new PodVariables(store).remove(first.id, 'topic', 2)
    expect(new PodVariables(store).values(first.id)).toEqual({})
    expect(() => parseResourceCommand({ type: 'saveVariable', podId: first.id, name: 'topic', value: 'x'.repeat(2049), revision: 0 })).toThrow()
    expect(() => parseResourceCommand({ type: 'saveVariable', podId: first.id, name: 'topic', value: 'x', revision: 0, secret: true })).toThrow()
  }
  finally { store.close(); rmSync(root, { recursive: true, force: true }) }
})
