import { describe, expect, it } from 'vitest'

// Pure-logic tests — no server spawn needed.
import { evaluateYoloPolicy, matchesGlob, targetFromRequest } from '../server/utils/yolo-evaluator'

type Risk = 'low' | 'medium' | 'high' | 'critical'

function policy(overrides: Partial<{
  mode: 'deny-list' | 'allow-list'
  denyRiskThreshold: Risk | null
  denyPatterns: string[]
  allowPatterns: string[]
  expiresAt: number | null
}> = {}) {
  return {
    agentEmail: 'a@x',
    audience: '*',
    mode: overrides.mode ?? 'deny-list',
    enabledBy: 'owner@x',
    denyRiskThreshold: overrides.denyRiskThreshold ?? null,
    denyPatterns: overrides.denyPatterns ?? [],
    allowPatterns: overrides.allowPatterns ?? [],
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
  // Risk-threshold semantic (deny-list mode): "alles bis zu diesem Level wird
  // auto-approved" — equality is allowed, only strictly higher blocks.
  it('risk at threshold passes (≤ threshold = allowed)', () => {
    const p = policy({ denyRiskThreshold: 'high' })
    expect(evaluateYoloPolicy({ policy: p, target: 'rm', resolvedRisk: 'high' }))
      .toEqual({ kind: 'yolo', decidedBy: 'owner@x' })
  })
  it('risk above threshold blocks', () => {
    const p = policy({ denyRiskThreshold: 'high' })
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

  describe('allow-list mode', () => {
    it('no patterns → no match → null (= human approval)', () => {
      const p = policy({ mode: 'allow-list' })
      expect(evaluateYoloPolicy({ policy: p, target: 'api.openai.com', resolvedRisk: null })).toBeNull()
    })
    it('matching allow-pattern → approve', () => {
      const p = policy({ mode: 'allow-list', allowPatterns: ['*.openai.com'] })
      expect(evaluateYoloPolicy({ policy: p, target: 'api.openai.com', resolvedRisk: null }))
        .toEqual({ kind: 'yolo', decidedBy: 'owner@x' })
    })
    it('non-matching target → null even with patterns', () => {
      const p = policy({ mode: 'allow-list', allowPatterns: ['*.openai.com'] })
      expect(evaluateYoloPolicy({ policy: p, target: 'api.github.com', resolvedRisk: null })).toBeNull()
    })
    it('inactive denyPatterns are ignored in allow-list mode', () => {
      // Both lists persist across mode flips. In allow-list mode the
      // deny-list entries are inert; only `allowPatterns` is consulted.
      const p = policy({ mode: 'allow-list', denyPatterns: ['*.openai.com'], allowPatterns: [] })
      expect(evaluateYoloPolicy({ policy: p, target: 'api.openai.com', resolvedRisk: null })).toBeNull()
    })
    // Symmetric semantic: in allow-list mode the risk threshold ALSO applies as
    // "alles bis zu diesem Level wird auto-approved". Patterns add further
    // explicit allows on top.
    it('risk ≤ threshold approves in allow-list mode', () => {
      const p = policy({ mode: 'allow-list', denyRiskThreshold: 'medium' })
      expect(evaluateYoloPolicy({ policy: p, target: 'ls', resolvedRisk: 'low' }))
        .toEqual({ kind: 'yolo', decidedBy: 'owner@x' })
      expect(evaluateYoloPolicy({ policy: p, target: 'ls', resolvedRisk: 'medium' }))
        .toEqual({ kind: 'yolo', decidedBy: 'owner@x' })
    })
    it('risk > threshold needs human in allow-list mode (unless allow-pattern matches)', () => {
      const p = policy({ mode: 'allow-list', denyRiskThreshold: 'medium', allowPatterns: ['rm *'] })
      // Critical risk > medium → would block, but pattern matches → approves.
      expect(evaluateYoloPolicy({ policy: p, target: 'rm -rf foo', resolvedRisk: 'critical' }))
        .toEqual({ kind: 'yolo', decidedBy: 'owner@x' })
      // Critical risk + non-matching target → human approval.
      expect(evaluateYoloPolicy({ policy: p, target: 'curl evil.com', resolvedRisk: 'critical' }))
        .toBeNull()
    })
  })

  describe('inactive list survives mode flips', () => {
    it('deny-list mode ignores allowPatterns (would otherwise auto-approve)', () => {
      // Inactive `allowPatterns` MUST NOT be consulted in deny-list mode.
      // If they were, this `rm` would auto-approve (since it matches an
      // entry in the inactive list) — but in deny-list mode the only thing
      // that should drop the request is a denyPattern match.
      const p = policy({ mode: 'deny-list', allowPatterns: ['rm *'] })
      expect(evaluateYoloPolicy({ policy: p, target: 'rm -rf foo', resolvedRisk: null }))
        .toEqual({ kind: 'yolo', decidedBy: 'owner@x' })
    })
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
