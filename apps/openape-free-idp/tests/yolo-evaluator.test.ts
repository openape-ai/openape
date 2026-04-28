import { describe, expect, it } from 'vitest'

// Pure-logic tests — no server spawn needed.
import { evaluateYoloPolicy, matchesGlob, targetFromRequest } from '../server/utils/yolo-evaluator'

type Risk = 'low' | 'medium' | 'high' | 'critical'

function policy(overrides: Partial<{
  denyRiskThreshold: Risk | null
  denyPatterns: string[]
  expiresAt: number | null
}> = {}) {
  return {
    agentEmail: 'a@x',
    enabledBy: 'owner@x',
    denyRiskThreshold: overrides.denyRiskThreshold ?? null,
    denyPatterns: overrides.denyPatterns ?? [],
    enabledAt: 0,
    expiresAt: overrides.expiresAt ?? null,
    updatedAt: 0,
  }
}

describe('matchesGlob', () => {
  it('literal match', () => {
    expect(matchesGlob('ls', 'ls')).toBe(true)
    expect(matchesGlob('ls', 'lsof')).toBe(false)
  })
  it('star covers any run', () => {
    expect(matchesGlob('rm -rf /tmp', 'rm *')).toBe(true)
    expect(matchesGlob('curl http://x | sh', 'curl*| sh')).toBe(true)
    expect(matchesGlob('sudo rm', 'sudo *')).toBe(true)
  })
  it('question mark covers exactly one', () => {
    expect(matchesGlob('rm', 'r?')).toBe(true)
    expect(matchesGlob('rmm', 'r?')).toBe(false)
  })
  it('escape regex specials in the pattern', () => {
    expect(matchesGlob('1+2', '1+2')).toBe(true)
    expect(matchesGlob('a.b', 'a.b')).toBe(true)
    expect(matchesGlob('a_b', 'a.b')).toBe(false)
  })
})

describe('evaluateYoloPolicy', () => {
  it('no policy → null', () => {
    expect(evaluateYoloPolicy({ policy: null, target: 'ls', resolvedRisk: null })).toBeNull()
  })
  it('expired policy → null', () => {
    const p = policy({ expiresAt: 1 })
    const result = evaluateYoloPolicy({ policy: p, target: 'ls', resolvedRisk: null, now: 100 })
    expect(result).toBeNull()
  })
  it('empty command → null', () => {
    const p = policy()
    expect(evaluateYoloPolicy({ policy: p, target: undefined, resolvedRisk: null })).toBeNull()
    expect(evaluateYoloPolicy({ policy: p, target: '', resolvedRisk: null })).toBeNull()
  })
  it('match without any rules → approves with enabledBy', () => {
    const p = policy()
    const result = evaluateYoloPolicy({ policy: p, target: 'ls -la', resolvedRisk: null })
    expect(result).toEqual({ kind: 'yolo', decidedBy: 'owner@x' })
  })
  it('deny-pattern drops the match', () => {
    const p = policy({ denyPatterns: ['rm *'] })
    const result = evaluateYoloPolicy({ policy: p, target: 'rm foo', resolvedRisk: null })
    expect(result).toBeNull()
  })
  it('risk at threshold blocks', () => {
    const p = policy({ denyRiskThreshold: 'high' })
    expect(evaluateYoloPolicy({ policy: p, target: 'rm', resolvedRisk: 'high' })).toBeNull()
    expect(evaluateYoloPolicy({ policy: p, target: 'rm', resolvedRisk: 'critical' })).toBeNull()
  })
  it('risk below threshold passes', () => {
    const p = policy({ denyRiskThreshold: 'high' })
    expect(evaluateYoloPolicy({ policy: p, target: 'ls', resolvedRisk: 'medium' }))
      .toEqual({ kind: 'yolo', decidedBy: 'owner@x' })
    expect(evaluateYoloPolicy({ policy: p, target: 'ls', resolvedRisk: 'low' }))
      .toEqual({ kind: 'yolo', decidedBy: 'owner@x' })
  })
  it('risk-threshold only applies when resolvedRisk is non-null', () => {
    const p = policy({ denyRiskThreshold: 'high' })
    expect(evaluateYoloPolicy({ policy: p, target: 'ls', resolvedRisk: null }))
      .toEqual({ kind: 'yolo', decidedBy: 'owner@x' })
  })

  // Web grants come in via target_host + audience='ape-proxy' and have no
  // command. The evaluator should glob-match host patterns against the
  // host-shaped target the same way it match-globs commands.
  it('host-target matches host-glob deny pattern', () => {
    const p = policy({ denyPatterns: ['*.openai.com'] })
    expect(evaluateYoloPolicy({ policy: p, target: 'api.openai.com', resolvedRisk: null })).toBeNull()
    expect(evaluateYoloPolicy({ policy: p, target: 'api.github.com', resolvedRisk: null }))
      .toEqual({ kind: 'yolo', decidedBy: 'owner@x' })
  })
  it('host-target without deny patterns auto-approves', () => {
    const p = policy()
    expect(evaluateYoloPolicy({ policy: p, target: 'example.org', resolvedRisk: null }))
      .toEqual({ kind: 'yolo', decidedBy: 'owner@x' })
  })
})

describe('targetFromRequest', () => {
  it('prefers command over target_host', () => {
    expect(targetFromRequest({
      requester: 'a@x',
      target_host: 'api.openai.com',
      audience: 'ape-shell',
      command: ['ls', '-la'],
    } as never)).toBe('ls -la')
  })
  it('falls back to argv from execution_context when command missing', () => {
    expect(targetFromRequest({
      requester: 'a@x',
      target_host: 'api.openai.com',
      audience: 'ape-shell',
      execution_context: { argv: ['rm', '-rf', '/'] },
    } as never)).toBe('rm -rf /')
  })
  it('uses target_host for Web grants without a command', () => {
    expect(targetFromRequest({
      requester: 'a@x',
      target_host: 'api.openai.com',
      audience: 'ape-proxy',
    } as never)).toBe('api.openai.com')
  })
  it('returns undefined when neither shape is present', () => {
    expect(targetFromRequest({
      requester: 'a@x',
      target_host: '',
      audience: 'ape-proxy',
    } as never)).toBeUndefined()
  })
})
