import { describe, expect, it } from 'vitest'
import type { AgentPatch, AgentSetup } from '../src/plan'
import { buildAgentPatch } from '../src/plan'

const setup: AgentSetup = { agentId: 'iurio', agentHome: '/Users/p/agent-identities/iurio' }

function sandboxOf(patch: AgentPatch) {
  const entry = patch.agents.entries[setup.agentId]
  if (!entry) throw new Error(`no config was emitted for agent ${setup.agentId}`)
  return entry.sandbox
}

// The patch is the whole product: if a key drifts from what OpenClaw expects,
// setup "succeeds" and the agent silently runs ungated or without its identity.
describe('agent config patch', () => {
  it('maps the agent to its auth home for the grant gate', () => {
    const gate = buildAgentPatch(setup).plugins.entries['openape-grant-gate']
    expect(gate.enabled).toBe(true)
    expect(gate.config.agents[setup.agentId]).toBe('/Users/p/agent-identities/iurio')
  })

  it('mounts the identity read-only into the sandbox home', () => {
    expect(sandboxOf(buildAgentPatch(setup)).docker.binds).toContain(
      '/Users/p/agent-identities/iurio/.config/apes:/home/sandbox/.config/apes:ro',
    )
  })

  it('opts into external bind sources, which OpenClaw blocks by default', () => {
    expect(sandboxOf(buildAgentPatch(setup)).docker.dangerouslyAllowExternalBindSources).toBe(true)
  })

  it('sandboxes every session, so exec never starts on the host', () => {
    expect(sandboxOf(buildAgentPatch(setup)).mode).toBe('all')
  })

  it('keeps extra binds after the identity mount', () => {
    const patch = buildAgentPatch({ ...setup, binds: ['/srv/ref:/reference:ro'] })
    expect(sandboxOf(patch).docker.binds).toEqual([
      '/Users/p/agent-identities/iurio/.config/apes:/home/sandbox/.config/apes:ro',
      '/srv/ref:/reference:ro',
    ])
  })

  it('defaults to the published sandbox image and honours an override', () => {
    expect(sandboxOf(buildAgentPatch(setup)).docker.image).toBe('ghcr.io/openape-ai/apes-sandbox:latest')
    expect(sandboxOf(buildAgentPatch({ ...setup, image: 'local:dev' })).docker.image).toBe('local:dev')
  })
})
