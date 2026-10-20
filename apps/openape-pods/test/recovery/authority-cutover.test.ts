// @vitest-environment node
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { afterEach, expect, it, vi } from 'vitest'
import { PodDatabase, schemaVersion } from '../../src/worker/storage/database'
import { ResourceRegistry } from '../../src/worker/resources/registry'
import { installExample } from '../../src/worker/runs/examples'
import { scriptContext } from '../../src/worker/runs/script-context'
import { scriptOperations } from '../../src/contracts/runs'
import type { RunInput } from '../../src/contracts/runs'
import { AgentAuthority } from '../../src/main/broker/authorization'
import { ApprovalHistory } from '../../src/worker/data/approval-history'

const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })

it('upgrades schema 52 without reinterpreting decisions and requires fresh validation before activation', () => {
  const root = mkdtempSync(join(tmpdir(), 'pods-cutover-')); roots.push(root)
  let store = new PodDatabase(root)
  const pod = store.createPod({ name: 'Existing automation' })
  const resources = new ResourceRegistry(store, () => {})
  installExample(store, resources, pod.id, 'deterministic', 'a'.repeat(64))
  const original = store.getPod(pod.id).activeScript
  store.db.prepare('UPDATE pods SET lifecycle=\'active\' WHERE id=?').run(pod.id)
  const id = randomUUID()
  store.db.prepare('INSERT INTO action_approvals(id,pod_id,action,object,payload,payload_hash,title,authority,state,created_at,updated_at) VALUES(?,?,\'program.run\',\'historical command\',\'{}\',?,\'Historical decision\',\'{}\',\'collecting\',1,1)').run(id, pod.id, 'a'.repeat(64))
  const before = store.db.prepare('SELECT * FROM action_approvals WHERE id=?').get(id)
  store.db.exec('DROP INDEX claims_supersedes; PRAGMA user_version=52'); store.close()
  store = new PodDatabase(root)
  try {
    expect(store.db.prepare('PRAGMA user_version').get()!.user_version).toBe(schemaVersion)
    expect(schemaVersion).toBeGreaterThan(52)
    expect(store.getPod(pod.id)).toMatchObject({ activeScript: original, lifecycle: 'paused' })
    expect(store.db.prepare('SELECT * FROM validations').all()).toEqual([])
    expect(store.db.prepare('SELECT * FROM action_approvals WHERE id=?').get(id)).toEqual(before)
    const history = new ApprovalHistory(store)
    expect(history.views()).toEqual([expect.objectContaining({ id, batchUrl: null, state: 'collecting' })])
    expect(history).not.toHaveProperty('consume')
    expect(history).not.toHaveProperty('request')
    expect(history).not.toHaveProperty('resolve')
  }
  finally { store.close() }
})

it('exposes generic tools but no executable mail or object-approval ports to scripts', async () => {
  const request = vi.fn(async () => ({}))
  const context = await scriptContext({}, { variables: {}, references: [], workspace: '/fixture' } as unknown as RunInput, request, () => {}, new AbortController().signal)
  expect(context).not.toHaveProperty('mail')
  expect(context).not.toHaveProperty('approvals')
  expect(scriptOperations.some(operation => /^(?:mail|approvals)\./.test(operation))).toBe(false)
  await (context.timing as () => Promise<unknown>)()
  expect(request).toHaveBeenCalledWith('run.timing', {})
  await (context.tools as { invoke: (body: unknown) => Promise<unknown> }).invoke({ application: 'node', argv: ['-e', 'console.log(2 + 2)'] })
  expect(request).toHaveBeenCalledWith('tools.invoke', { application: 'node', argv: ['-e', 'console.log(2 + 2)'] })
})

it('has no Pods command-token authority or direct-launch fallback in user-program entry points', () => {
  expect(AgentAuthority.prototype).not.toHaveProperty('authorizeProgram')
  for (const file of ['src/main/broker/tools.ts', 'src/main/programs/invoke.ts', 'src/main/programs/session.ts', 'src/worker/runs/runner.ts', 'src/worker/dependencies/install.ts']) {
    const source = readFileSync(resolve(file), 'utf8')
    expect(source, file).not.toMatch(/\b(?:launchSandbox|launchTerminal|authorizeProgram)\s*\(/)
  }
  const source = readFileSync(resolve('src/worker/runs/script-entry.ts'), 'utf8')
  expect(source).not.toContain('JSON.parse(await readFile(process.argv[2]')
})
