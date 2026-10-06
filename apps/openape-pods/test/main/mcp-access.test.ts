import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, expect, it } from 'vitest'
import { McpAccessPolicy } from '../../src/main/codex/access'
import { parseMcpAccessCommand } from '../../src/contracts/mcp-access'

const roots: string[] = []
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'pods-access-')); roots.push(root)
  let now = 1000
  const policy = new McpAccessPolicy(root, () => now)
  return { policy, root, advance: (ms: number) => { now += ms }, restart: () => new McpAccessPolicy(root, () => now) }
}
const request = (action: Record<string, unknown>) => ({ id: '00000000-0000-4000-8000-000000000001', action })
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })
it('defaults off and expires at the boundary across restarts without extending a grant', () => {
  const f = fixture()
  expect(() => f.policy.assert(request({ action: 'list' }))).toThrow('off')
  expect(f.policy.set('read', 'hour').expiresAt).toBe(3601000)
  f.advance(5000)
  expect(f.policy.set('write', 'hour').expiresAt).toBe(3601000)
  expect(f.restart().get().expiresAt).toBe(3601000)
  f.advance(3595000)
  expect(() => f.policy.assert(request({ action: 'run' }))).toThrow('off')
  expect(f.restart().get()).toEqual({ mode: 'off', duration: 'hour', expiresAt: null })
})
it('resets the deadline only for a different duration or a new grant and supports permanent access', () => {
  const f = fixture(); f.policy.set('write', 'hour'); f.advance(1000)
  expect(f.policy.set('write', 'day').expiresAt).toBe(86402000)
  expect(f.policy.set('read', 'permanent').expiresAt).toBeNull()
  f.advance(864000000); f.policy.assert(request({ action: 'inspect' }))
  f.policy.set('off', 'hour'); expect(f.policy.set('write', 'hour').expiresAt).toBe(867602000)
})
it('allows inspection and context selection but denies every mutation route in read-only mode', () => {
  const { policy } = fixture(); policy.set('read', 'hour')
  for (const action of [{ action: 'runtime' }, { action: 'list' }, { action: 'select', podIds: [] }, { action: 'inspect' }, { action: 'resources', command: { type: 'list' } }, { action: 'workspace', query: { type: 'read' } }, { action: 'workspace', query: { type: 'operation' } }]) expect(() => policy.assert(request(action))).not.toThrow()
  for (const action of [{ action: 'run' }, { action: 'activate' }, { action: 'revise' }, { action: 'resources', command: { type: 'removeVariable' } }, { action: 'scripts', command: { type: 'prepareDependencies' } }, { action: 'workspace', query: { type: 'submit' } }, { action: 'mcpAccess', mode: 'write' }, { action: 'future-action' }]) expect(() => policy.assert(request(action))).toThrow('read-only')
  policy.set('write', 'hour'); expect(() => policy.assert(request({ action: 'run' }))).not.toThrow()
  policy.set('off', 'hour'); expect(() => policy.assert(request({ action: 'runtime' }))).toThrow('off')
})
it('rejects malformed settings and corrupted persisted grants', () => {
  const { root } = fixture()
  for (const value of [null, [], { type: 'set', mode: ['read'], duration: 'hour' }, { type: 'set', mode: 'write', duration: 'week' }, { type: 'set', mode: 'read', duration: 'hour', expiresAt: null }, { type: 'get', mode: 'write' }]) expect(() => parseMcpAccessCommand(value)).toThrow()
  writeFileSync(join(root, 'mcp-access.json'), JSON.stringify({ mode: 'write', duration: 'hour', expiresAt: null }))
  expect(() => new McpAccessPolicy(root)).toThrow('expiry')
})

it('permits bounded network reads but requires write access for preview, pause and processing', () => {
  const { policy } = fixture(); policy.set('read', 'hour')
  const id = '00000000-0000-4000-8000-000000000001'
  for (const command of [{ type: 'list' }, { type: 'detail', id, revision: 1 }, { type: 'legacyItems', id, revision: 1, after: null }]) expect(() => policy.assert(request({ action: 'networks', command }))).not.toThrow()
  for (const command of [{ type: 'pause', id, revision: 1 }, { type: 'preview', id, revision: 1, podIds: [id], pausedPodIds: [id], budget: 1 }, { type: 'process', id, revision: 1, previewId: id }]) expect(() => policy.assert(request({ action: 'networks', command }))).toThrow('read-only')
  expect(() => policy.assert(request({ action: 'networks', command: { type: 'list' }, ownerOperation: true }))).toThrow('fields')
  expect(() => policy.assert(request({ action: 'networks', command: { type: 'activate', id, revision: 1 } }))).toThrow('desktop')
})
