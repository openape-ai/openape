import { sequenceParts } from '../../src/contracts/workflows'
import type { CentralStatus } from '../../src/contracts/central'
import type { BrowserWorkspaceClient } from '../../src/renderer/central/client'
import { centralFixture } from './central-fixture'
import { installWorkspace, podId, pods } from '../layout/workspace-fixture'

export async function browserFixture() {
  const fixture = centralFixture()
  const workflows = { workflows: [{ ...sequenceParts, id: '00000000-0000-4000-8000-000000000004', revision: 1, name: 'Morning review', nodes: [{ podId, after: [], handoff: false }], schedule: null, enabled: false, paused: false, nextAt: null }], runs: [] }
  const status: CentralStatus = { state: 'online', runtimeId: fixture.host.id, error: null, since: 1790000000000, lastOnlineAt: 1790000000000, gateUntil: 0, lastTickAt: null, tickingSince: null, tickPhase: null, tickTimeout: null, format: 2, lastPublication: null, uncertain: [] }
  const bridge = installWorkspace({
    workflows: async () => structuredClone(workflows),
    programs: async () => null,
    onboarding: async () => ({ connections: [{ id: 'owner', provider: 'openape', state: 'ready', account: 'owner@example.invalid', error: null, login: null }], owner: 'owner', complete: true, runtime: { ready: true, error: null } }),
    central: async (command) => {
      if (command.type === 'status') return { ...status, enabled: true }
      if (command.type === 'inventory') return fixture.client.inventory()
      if (command.type === 'read') return fixture.client.read(fixture.host.id, podId)
      return { requestError: { status: 400, message: 'No fixture change feed' } }
    },
  })
  const [details, scripts, resources, scheduling, runs] = await Promise.all([
    bridge.details({ type: 'list', podId }), bridge.scripts({ type: 'list', podId }), bridge.resources({ type: 'list', podId }), bridge.scheduling({ type: 'list', podId }), bridge.runs({ type: 'list', podId }),
  ])
  Object.assign(fixture.view, { id: podId, details, scripts, resources, scheduling, runs })
  fixture.host.workspace.pods = pods.map(pod => ({ ...pod, online: true }))
  fixture.host.workflows = workflows
  const client: BrowserWorkspaceClient = { ...fixture.client, session: async () => ({ subject: 'owner@example.invalid' }) }
  return { ...fixture, client, bridge, podId }
}
