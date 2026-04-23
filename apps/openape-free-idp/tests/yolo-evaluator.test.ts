import { describe, expect, it } from 'vitest'

// Pure-logic tests — no server spawn needed.
import { evaluateYoloPolicy, matchesGlob } from '../server/utils/yolo-evaluator'

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
    expect(evaluateYoloPolicy({ policy: null, command: ['ls'], resolvedRisk: null })).toBeNull()
  })
  it('expired policy → null', () => {
    const p = policy({ expiresAt: 1 })
    const result = evaluateYoloPolicy({ policy: p, command: ['ls'], resolvedRisk: null, now: 100 })
    expect(result).toBeNull()
  })
  it('empty command → null', () => {
    const p = policy()
    expect(evaluateYoloPolicy({ policy: p, command: undefined, resolvedRisk: null })).toBeNull()
    expect(evaluateYoloPolicy({ policy: p, command: [], resolvedRisk: null })).toBeNull()
  })
  it('match without any rules → approves with enabledBy', () => {
    const p = policy()
    const result = evaluateYoloPolicy({ policy: p, command: ['ls', '-la'], resolvedRisk: null })
    expect(result).toEqual({ kind: 'yolo', decidedBy: 'owner@x' })
  })
  it('deny-pattern drops the match', () => {
    const p = policy({ denyPatterns: ['rm *'] })
    const result = evaluateYoloPolicy({ policy: p, command: ['rm', 'foo'], resolvedRisk: null })
    expect(result).toBeNull()
  })
  it('risk at threshold blocks', () => {
    const p = policy({ denyRiskThreshold: 'high' })
    expect(evaluateYoloPolicy({ policy: p, command: ['rm'], resolvedRisk: 'high' })).toBeNull()
    expect(evaluateYoloPolicy({ policy: p, command: ['rm'], resolvedRisk: 'critical' })).toBeNull()
  })
  it('risk below threshold passes', () => {
    const p = policy({ denyRiskThreshold: 'high' })
    expect(evaluateYoloPolicy({ policy: p, command: ['ls'], resolvedRisk: 'medium' }))
      .toEqual({ kind: 'yolo', decidedBy: 'owner@x' })
    expect(evaluateYoloPolicy({ policy: p, command: ['ls'], resolvedRisk: 'low' }))
      .toEqual({ kind: 'yolo', decidedBy: 'owner@x' })
  })
  it('risk-threshold only applies when resolvedRisk is non-null', () => {
    const p = policy({ denyRiskThreshold: 'high' })
    expect(evaluateYoloPolicy({ policy: p, command: ['ls'], resolvedRisk: null }))
      .toEqual({ kind: 'yolo', decidedBy: 'owner@x' })
  })
})
