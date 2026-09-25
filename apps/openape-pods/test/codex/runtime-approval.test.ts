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
