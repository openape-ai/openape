import type { PodsBridge, PodStatus } from '../../src/contracts/ipc'
import type { PodDetails } from '../../src/contracts/details'
import type { ResourceState } from '../../src/contracts/resources'
import type { RunView } from '../../src/contracts/runs'
import type { ScriptView } from '../../src/contracts/scripts'
import type { StoredPod } from '../../src/contracts/control'

// The synthetic profile the former packaged `pod-workspace` E2E seeded into
// SQLite, served through the same bridge the renderer uses. Long, unbroken
// values are deliberate: they are what pushes a layout wide.
export const podId = '00000000-0000-4000-8000-000000000001'
const archivedId = '00000000-0000-4000-8000-000000000002'
const scriptHash = 'a'.repeat(64)
const citation = { id: 'order-mail-1', version: '1', hash: 'b'.repeat(64), locator: 'fixture:Northwind/order-42' }
export const pods: StoredPod[] = [
  { id: podId, name: 'Mail knowledge', revision: 2, lifecycle: 'paused', activeScript: scriptHash },
  { id: archivedId, name: 'Archived research', revision: 2, lifecycle: 'archived', activeScript: 'c'.repeat(64) },
]
const details: PodDetails = {
  claims: [
    { id: 'delivery-1', matter: 'Northwind · Order 42', kind: 'finding', text: 'Delivery is confirmed for Tuesday.', citations: [citation], supersedes: 'delivery-0', revision: 2, current: true },
    { id: 'delivery-0', matter: 'Northwind · Order 42', kind: 'finding', text: 'Delivery was requested for Monday.', citations: [{ ...citation, id: 'order-mail-0', version: '0' }], supersedes: null, revision: 1, current: false },
    { id: 'question', matter: 'Northwind · Order 42', kind: 'question', text: 'Who will accept delivery?', citations: [citation], supersedes: null, revision: 2, current: true },
    { id: 'gap', matter: 'Attachment verification', kind: 'gap', text: 'The encrypted attachment could not be inspected.', citations: [citation], supersedes: null, revision: 2, current: true },
  ],
  total: 4,
  counts: { finding: 1, question: 1, gap: 1 },
  checkpointRevision: 2,
  versions: [{ hash: scriptHash, assignmentRevision: 1, validated: true, active: true }],
  source: null,
}
const resources: ResourceState = {
  directories: { home: '/Users/fixture/Library/Application Support/OpenApe Pods/pods/00000000-0000-4000-8000-000000000001/home', workspace: '/Users/fixture/Library/Application Support/OpenApe Pods/pods/00000000-0000-4000-8000-000000000001/workspace' },
  variables: [{ name: 'customer_folder_with_a_rather_long_descriptive_name', value: 'Northwind/Orders/2026/September', revision: 1 }],
  resources: [
    { id: '00000000-0000-4000-8000-000000000010', podId, revision: 1, kind: 'reference', state: 'ready', name: 'Reference', configuration: { path: '/Users/fixture/Documents/Shared customer documentation/reference.txt' } },
    { id: '00000000-0000-4000-8000-000000000011', podId, revision: 1, kind: 'directory', state: 'ready', name: 'Orders', configuration: { path: '/Users/fixture/Documents/Customers/Northwind Trading Company/Orders/2026', access: 'readWrite' } },
    { id: '00000000-0000-4000-8000-000000000012', podId, revision: 1, kind: 'connection', state: 'expired', name: 'Microsoft fixture', configuration: { account: 'fixture@example.invalid', scope: 'Read-only selected folders' } },
    { id: '00000000-0000-4000-8000-000000000013', podId, revision: 1, kind: 'credential', state: 'ready', name: 'notification_token', configuration: { alias: 'notification_token', credentialId: '00000000-0000-4000-8000-000000000014' } },
  ],
  epoch: 3,
}
const code = [
  'export async function run(context) {',
  '  const folder = context.variables["customer_folder_with_a_rather_long_descriptive_name"]',
  '  const token = await context.credentials.get("notification_token")',
  '  await context.progress.commit({ checkpoint: { folder, reviewedAt: new Date().toISOString() }, sources: [], claims: [] })',
  '  return { status: "completed", summary: "Local example completed (" + folder.length + ")", completedInputIds: [], gapIds: [] }',
  '}',
].join('\n')
const script: ScriptView = {
  resourceEpoch: 3,
  credentialAliases: ['notification_token'],
  pod: pods[0]!,
  versions: details.versions,
  drafts: [],
  environment: { PODS_POD_ID: podId, PODS_WORKSPACE: resources.directories!.workspace },
  source: { kind: 'version', id: scriptHash, code, capabilities: ['credential.notification_token'], revision: 1, assignmentRevision: 1, hash: scriptHash, validated: true, evidence: null, credentialAccessApproved: true },
}
const runs: RunView = {
  runs: [{ id: '00000000-0000-4000-8000-000000000020', podId, scriptHash, state: 'completed', startedAt: 1_790_000_000_000, finishedAt: 1_790_000_004_000, summary: 'Local example completed (1)', error: null, checkpointRevision: 2, recovery: null }],
  events: [],
}
const ready: PodStatus = { version: 1, mode: 'fixture', executionEnabled: true, worker: { state: 'ready', pid: 42, error: null }, runtime: { electron: '40.9.3', node: '24.14.1' } }

export function installWorkspace(overrides: Partial<PodsBridge> = {}): PodsBridge {
  const bridge: Partial<PodsBridge> = {
    getStatus: async () => ready,
    onStatus: () => () => {},
    language: async () => 'en',
    workspace: async () => ({ organization: { revision: 1, groups: [] }, pods: structuredClone(pods) }),
    details: async command => command.type === 'source'
      ? { ...structuredClone(details), source: { citation, content: 'Sent reply confirms Tuesday delivery. The receiving contact at Northwind Trading Company has not been named yet; the warehouse asked for confirmation before 16:00.', original: { ...citation, id: 'raw-order-mail', locator: 'fixture:Northwind/order-42/raw' } } }
      : structuredClone(details),
    resources: async () => structuredClone(resources),
    scripts: async () => structuredClone(script),
    runs: async () => structuredClone(runs),
    scheduling: async () => ({ spec: null, enabled: false, revision: 1, nextAt: null, error: null, pending: 0, blocked: 0, concurrency: 2 }),
    master: async () => ({ connected: true, state: 'idle', error: null, messages: [], drafts: [], proposals: [] }),
    chats: async () => ({ conversations: [], activeConversationId: null }),
    workflows: async () => ({ workflows: [], runs: [] }),
    onboarding: async () => ({ connections: [], complete: true, owner: null, runtime: { ready: true, error: null } }),
    data: async () => ({ usedBytes: 0, freeBytes: 1024 ** 3, limitBytes: 10 * 1024 ** 3, pendingDeletion: 0, busy: false, error: null }),
    programs: async () => { throw new Error('No program fixture configured') },
    packages: async () => { throw new Error('No package search fixture configured') },
    ...overrides,
  }
  window.pods = bridge as PodsBridge
  return window.pods
}
