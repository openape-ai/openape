import { describe, expect, it } from 'vitest'
import { buildNestComposeYaml, buildPodComposeYaml, buildPodEnvFile } from '../server/utils/hatch-bundle'

// These tests verify the hatch bundles that ship to a new Docker nest:
// (1) the bridge targets troop (not chat), and (2) the bundle is
// subscription-only — no separate litellm container, the in-nest codex-proxy
// on 127.0.0.1:4000 is the model source (M3.4: #575 for compose, #576 here).

describe('nest/hatch bundle (BYO Docker path)', () => {
  const yaml = buildNestComposeYaml({
    troopUrl: 'https://troop.openape.ai',
    ownerEmail: 'owner@example.com',
    hatchToken: 'nest-hatch-test',
    generatedAt: '2026-06-03T00:00:00.000Z',
  })

  it('sets OPENAPE_BRIDGE_TARGET=troop in the openape-nest service env', () => {
    expect(yaml).toContain('OPENAPE_BRIDGE_TARGET: troop')
  })

  it('includes the troop URL', () => {
    expect(yaml).toContain('OPENAPE_TROOP_URL: https://troop.openape.ai')
  })

  it('includes the hatch token', () => {
    expect(yaml).toContain('OPENAPE_HATCH_TOKEN: nest-hatch-test')
  })

  it('includes the owner email', () => {
    expect(yaml).toContain('OPENAPE_HATCH_OWNER: owner@example.com')
  })

  it('does not reference chat.openape.ai (bridge target is troop, not chat)', () => {
    expect(yaml).not.toContain('chat.openape.ai')
  })

  it('does not provision a separate litellm container (codex-proxy is in-nest)', () => {
    expect(yaml).not.toContain('openape-llm')
    expect(yaml).not.toContain('litellm.yaml')
  })

  it('points the bridge at the in-nest codex-proxy on loopback', () => {
    expect(yaml).toContain('LITELLM_BASE_URL: http://127.0.0.1:4000/v1')
  })

  it('embeds no keyed provider secrets (subscription-only)', () => {
    expect(yaml).not.toContain('ANTHROPIC_API_KEY')
    expect(yaml).not.toContain('CHATGPT_OAUTH_TOKEN')
  })

  it('defaults the bridge model to gpt-5 (no Claude)', () => {
    expect(yaml).toContain('gpt-5')
    expect(yaml).not.toContain('claude-haiku')
  })
})

describe('pod/hatch bundle (cloud-provisioned Docker path)', () => {
  const yaml = buildPodComposeYaml({
    troopUrl: 'https://troop.openape.ai',
    ownerEmail: 'owner@example.com',
    hatchToken: 'nest-hatch-pod-test',
  })

  it('sets OPENAPE_BRIDGE_TARGET=troop in the openape-nest service env', () => {
    expect(yaml).toContain('OPENAPE_BRIDGE_TARGET: troop')
  })

  it('includes the troop URL', () => {
    expect(yaml).toContain('OPENAPE_TROOP_URL: https://troop.openape.ai')
  })

  it('includes the hatch token', () => {
    expect(yaml).toContain('OPENAPE_HATCH_TOKEN: nest-hatch-pod-test')
  })

  it('does not reference chat.openape.ai (bridge target is troop, not chat)', () => {
    expect(yaml).not.toContain('chat.openape.ai')
  })

  it('does not provision a separate litellm container (codex-proxy is in-nest)', () => {
    expect(yaml).not.toContain('openape-llm')
    expect(yaml).not.toContain('litellm.yaml')
  })

  it('points the bridge at the in-nest codex-proxy on loopback', () => {
    expect(yaml).toContain('LITELLM_BASE_URL: http://127.0.0.1:4000/v1')
  })
})

describe('pod/hatch env file', () => {
  it('does not embed OPENAPE_BRIDGE_TARGET (it belongs in compose environment block, not .env)', () => {
    // The bridge reads OPENAPE_BRIDGE_TARGET from the container environment,
    // not from the .env file. If it were in .env it could be accidentally
    // overridden. The compose environment: block takes precedence anyway, but
    // this confirms the split is intentional.
    const env = buildPodEnvFile({ APE_CHAT_BRIDGE_MODEL: 'gpt-5' })
    expect(env).not.toContain('OPENAPE_BRIDGE_TARGET')
  })

  it('includes model key from secrets', () => {
    const env = buildPodEnvFile({ APE_CHAT_BRIDGE_MODEL: 'gpt-5.4' })
    expect(env).toContain('APE_CHAT_BRIDGE_MODEL=gpt-5.4')
  })

  it('defaults model to gpt-5 when not in secrets (no Claude)', () => {
    const env = buildPodEnvFile({})
    expect(env).toContain('APE_CHAT_BRIDGE_MODEL=gpt-5')
    expect(env).not.toContain('claude-haiku')
  })

  it('embeds no keyed provider secrets (subscription-only)', () => {
    const env = buildPodEnvFile({ ANTHROPIC_API_KEY: 'sk-ant-x', CHATGPT_OAUTH_TOKEN: 'tok-y' })
    expect(env).not.toContain('ANTHROPIC_API_KEY')
    expect(env).not.toContain('CHATGPT_OAUTH_TOKEN')
    expect(env).not.toContain('sk-ant-x')
  })
})
