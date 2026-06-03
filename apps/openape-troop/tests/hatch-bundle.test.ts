import { describe, expect, it } from 'vitest'
import { buildNestComposeYaml, buildPodComposeYaml, buildPodEnvFile } from '../server/utils/hatch-bundle'

// These tests verify that every hatch bundle that ships to a new Docker nest
// includes OPENAPE_BRIDGE_TARGET=troop. Without it the bridge defaults to
// 'chat', connecting to chat.openape.ai instead of the troop WS — the nest
// would appear online but never be controlled by the troop owner.

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
})

describe('pod/hatch env file', () => {
  it('does not embed OPENAPE_BRIDGE_TARGET (it belongs in compose environment block, not .env)', () => {
    // The bridge reads OPENAPE_BRIDGE_TARGET from the container environment,
    // not from the .env file. If it were in .env it could be accidentally
    // overridden. The compose environment: block takes precedence anyway, but
    // this confirms the split is intentional.
    const env = buildPodEnvFile({ ANTHROPIC_API_KEY: 'sk-ant-x', CHATGPT_OAUTH_TOKEN: '' })
    expect(env).not.toContain('OPENAPE_BRIDGE_TARGET')
  })

  it('includes model key from secrets', () => {
    const env = buildPodEnvFile({ APE_CHAT_BRIDGE_MODEL: 'gpt-5.4' })
    expect(env).toContain('APE_CHAT_BRIDGE_MODEL=gpt-5.4')
  })

  it('defaults model to claude-haiku-4-5 when not in secrets', () => {
    const env = buildPodEnvFile({})
    expect(env).toContain('APE_CHAT_BRIDGE_MODEL=claude-haiku-4-5')
  })
})
