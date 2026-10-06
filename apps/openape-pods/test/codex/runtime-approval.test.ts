// @vitest-environment node
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { RuntimeApprovalPolicy } from '../../src/main/codex/runtime-approval'
import { parseCentralCommand } from '../../src/contracts/central'
import { parseWorkspaceAction } from '../../src/contracts/codex'

const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })
const id = '00000000-0000-4000-8000-000000000001'
function fixture() { const root = mkdtempSync(join(tmpdir(), 'pods-mcp-approval-')); roots.push(root); return { root, policy: new RuntimeApprovalPolicy(root) } }

it('defaults off, persists trusted provenance and stops new approvals when switched off', () => {
  const { root, policy } = fixture()
  policy.recordPod(id)
  expect(policy.allows(id)).toBe(false)
  policy.setEnabled(true)
  expect(policy.allows(id)).toBe(true)
  expect(policy.allows('00000000-0000-4000-8000-000000000002')).toBe(false)
  const restored = new RuntimeApprovalPolicy(root)
  expect(restored.allows(id)).toBe(true)
  restored.setEnabled(false)
  expect(new RuntimeApprovalPolicy(root).allows(id)).toBe(false)
})

it('binds central creation provenance to the operation, runtime and parsed command', () => {
  const { root, policy } = fixture()
  const command = parseCentralCommand({ channel: 'workspace', body: { type: 'create', name: 'Local MCP Pod' } })
  policy.recordCreation(id, id, command)
  const restored = new RuntimeApprovalPolicy(root)
  expect(restored.createdLocally(id, id, command)).toBe(true)
  expect(restored.createdLocally(undefined, id, command)).toBe(false)
  expect(restored.createdLocally(id, null, command)).toBe(false)
  const changed = parseCentralCommand({ channel: 'workspace', body: { type: 'create', name: 'Different Pod' } })
  expect(restored.createdLocally(id, id, changed)).toBe(false)
  expect(() => restored.recordCreation(id, id, changed)).toThrow('reused')
})

it('rejects damaged preferences and attempts to set the option or forge provenance through MCP', () => {
  const { root } = fixture()
  writeFileSync(join(root, 'mcp-runtime-approval.json'), '{"enabled":"true","pods":[],"creations":{}}')
  expect(() => new RuntimeApprovalPolicy(root)).toThrow()
  expect(() => parseWorkspaceAction({ action: 'workspace', query: { type: 'submit', id, runtimeId: id, revision: 1, command: { channel: 'runtimeApproval', body: { type: 'set', enabled: true } } } })).toThrow()
  expect(() => parseCentralCommand({ channel: 'workspace', body: { type: 'create', name: 'Forged', localMcp: true } })).toThrow()
})

const binding = { runtimeId: id, issuer: 'https://owner.example.test', subject: 'owner-123', account: 'owner@example.test' }

it('covers existing and future Pods only for the approved owner and runtime after restart', () => {
  const { root, policy } = fixture()
  policy.setStanding(binding)
  const restored = new RuntimeApprovalPolicy(root)
  for (const podId of [id, '00000000-0000-4000-8000-000000000002']) expect(restored.allows(podId, binding)).toBe(true)
  expect(restored.allows(id)).toBe(false)
  for (const key of ['runtimeId', 'issuer', 'subject', 'account'] as const) expect(restored.allows(id, { ...binding, [key]: 'foreign' })).toBe(false)
  restored.setStanding(null)
  expect(new RuntimeApprovalPolicy(root).allows(id, binding)).toBe(false)
})

it('does not expand legacy MCP consent during migration', () => {
  const { root } = fixture()
  writeFileSync(join(root, 'mcp-runtime-approval.json'), JSON.stringify({ enabled: true, pods: [id], creations: {} }))
  const policy = new RuntimeApprovalPolicy(root)
  expect(policy.allows(id)).toBe(true)
  expect(policy.standingAllows(binding)).toBe(false)
  expect(policy.allows('00000000-0000-4000-8000-000000000002', binding)).toBe(false)
})

it('serializes disabling behind an in-flight decision and releases the queue after errors', async () => {
  const { policy } = fixture()
  policy.setStanding(binding)
  let finish!: () => void
  const pending = new Promise<void>((resolve) => { finish = resolve })
  const approval = policy.exclusive(async () => { await pending; throw new Error('Decision failed') })
  const refusal = expect(approval).rejects.toThrow('Decision failed')
  const disable = policy.exclusive(async () => { policy.setStanding(null) })
  expect(policy.standingAllows(binding)).toBe(true)
  finish(); await refusal; await disable
  expect(await policy.exclusive(async () => policy.allows(id, binding))).toBe(false)
})
