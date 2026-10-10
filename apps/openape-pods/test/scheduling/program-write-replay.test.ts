// @vitest-environment node
import { randomUUID } from 'node:crypto'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import type { ProgramAssignment } from '../../src/contracts/programs'
import { programRequest } from '../../src/main/programs/invoke'
import { closeNetworks, networkFixture } from './network-fixture'

vi.mock('../../src/worker/runs/runner', () => ({ executeScript: vi.fn() }))
afterEach(async () => { await closeNetworks(); vi.restoreAllMocks() })

/** A reviewed adapter with one read and one write operation; the worker classifies each call by its action. */
function chatAdapter(): string {
  const path = join(mkdtempSync(join(tmpdir(), 'pods-write-adapter-')), 'chat.toml')
  writeFileSync(path, 'schema="openape-shapes/v1"\n[cli]\nid="chat"\nexecutable="chat"\naudience="shapes"\n[[operation]]\nid="list"\ncommand=["list"]\ndisplay="List messages"\naction="list"\nrisk="low"\nresource_chain=["message:*"]\n[[operation]]\nid="send"\ncommand=["send"]\nrequired_options=["text"]\ndisplay="Send {text}"\naction="send"\nrisk="medium"\nresource_chain=["message:*"]\n')
  return path
}

it.each([
  { argv: ['send', '--text', 'Briefing'], write: true },
  { argv: ['list'], write: false },
])('does not replay a failed run automatically after an application write ($argv.0)', async ({ argv, write }) => {
  const calls: string[][] = []
  const f: ReturnType<typeof networkFixture> = networkFixture({ tool: async (body, _signal, scope) => { calls.push(programRequest(f.resources.list(scope.podId), scope.podId, scope.capabilities, body).argv); return { exitCode: 0, stdout: '', stderr: '' } } })
  const applicationId = randomUUID(); const capability = `tool.app_${applicationId.replaceAll('-', '')}.invoke`
  const source = f.pod('Briefing', { takes: [], gives: ['brief'], summary: 'Posts the briefing' }, async (_items, invoke) => {
    await invoke('tools.invoke', { application: 'chat', argv })
    throw new Error('Synthetic failure after the call')
  })
  const consumer = f.pod('Consumer', { takes: ['brief'], gives: [], summary: 'Consumes' }, async () => {})
  f.resources.assignProgram(source, applicationId, { type: 'program', name: 'chat', cliId: 'chat', adapterPath: chatAdapter(), capability } as ProgramAssignment, f.resources.epoch(source))
  const pod = f.store.getPod(source)
  const row = f.store.db.prepare('SELECT manifest FROM scripts WHERE pod_id=? AND hash=?').get(source, pod.activeScript!)!
  f.store.db.prepare('UPDATE scripts SET manifest=? WHERE pod_id=? AND hash=?').run(JSON.stringify({ ...JSON.parse(row.manifest as string), capabilities: [capability] }), source, pod.activeScript!)
  f.store.db.prepare('INSERT OR REPLACE INTO validations VALUES(?,?,?,?,?)').run(source, pod.activeScript!, pod.bindingRevision, f.resources.epoch(source), '{}')
  const id = f.create([{ podId: source, source: { schedule: null }, serialCase: false }, { podId: consumer, source: null, serialCase: false }], ['brief'])
  f.process(id, [source], [source], 1); f.engine.tick()
  await expect.poll(() => f.store.db.prepare('SELECT state FROM network_invocations WHERE pod_id=?').get(source)?.state).toBe('blocked')
  const control = f.store.db.prepare('SELECT c.failure_kind,c.retry_at FROM network_invocation_controls c JOIN network_invocations n ON n.run_id=c.run_id WHERE n.pod_id=?').get(source)!
  expect(calls).toEqual([argv])
  if (write) {
    // The write is recorded like an HTTP effect; the run goes to owner review instead of an automatic retry.
    expect(f.store.db.prepare('SELECT operation,state FROM effect_ledger WHERE pod_id=?').all(source)).toEqual([{ operation: 'program.call', state: 'completed' }])
    expect(control).toEqual({ failure_kind: 'recovery', retry_at: null })
  }
  else {
    expect(f.store.db.prepare('SELECT 1 FROM effect_ledger WHERE pod_id=?').all(source)).toEqual([])
    expect(control.failure_kind).toBe('transient'); expect(control.retry_at).toEqual(expect.any(Number))
  }
})
