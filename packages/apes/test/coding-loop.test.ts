import { describe, expect, it, vi } from 'vitest'
import { runCodingTask } from '../src/lib/coding/coding-loop'
import type { CodingTaskDeps, ShellResult } from '../src/lib/coding/coding-loop'
import type { MergePolicy } from '../src/lib/coding/merge-policy'
import { createLlmReviewer, createLlmRiskAssessor } from '../src/lib/coding/llm-review'

const runtimeConfig = { apiBase: 'http://x/v1', apiKey: 'k', model: 'm' }
const POLICY: MergePolicy = { autoMergeEnabled: true, autoPaths: ['**/*.md'], riskPaths: ['infra/**'] }

// Mock shell: pattern-match the command, return canned results. Records
// every command for assertions.
function mockShell(opts: { changed: string[], createExit?: number }) {
  const calls: string[] = []
  const fn = vi.fn(async (cmd: string): Promise<ShellResult> => {
    calls.push(cmd)
    if (cmd.includes('worktree add')) return { stdout: '', stderr: '', exit_code: opts.createExit ?? 0 }
    if (cmd.includes('diff --cached --name-only')) return { stdout: opts.changed.join('\n'), stderr: '', exit_code: 0 }
    if (cmd.includes('diff --cached')) return { stdout: 'some diff', stderr: '', exit_code: 0 }
    if (cmd.includes('pr create') || cmd.includes('repos pr create')) return { stdout: 'https://github.com/o/r/pull/77', stderr: '', exit_code: 0 }
    return { stdout: '', stderr: '', exit_code: 0 }
  })
  return { fn, calls }
}

function baseDeps(over: Partial<CodingTaskDeps> = {}): CodingTaskDeps {
  return {
    runtimeConfig,
    tools: [],
    persona: 'You are a coding agent.',
    maxSteps: 5,
    policy: POLICY,
    reviewer: async () => ({ approved: true }),
    riskAssessor: async () => ({ risky: false }),
    runLoopImpl: async () => ({ status: 'ok', finalMessage: 'done', stepCount: 1, trace: [] }),
    ...over,
  }
}

const input = { issue: { number: 42, title: 'Fix login', type: 'fix' }, repo: 'https://github.com/o/r.git', forge: 'github' as const }

describe('runCodingTask orchestrator', () => {
  it('chore change → auto-armed without reviewer', async () => {
    const { fn, calls } = mockShell({ changed: ['docs/readme.md'] })
    const reviewer = vi.fn(async () => ({ approved: true }))
    const r = await runCodingTask(input, baseDeps({ shell: fn, reviewer }))
    expect(r.outcome).toBe('auto-armed')
    expect(r.decision?.classification).toBe('chore')
    expect(reviewer).not.toHaveBeenCalled()
    expect(calls.some(c => c.includes('pr merge') || c.includes('auto-complete') || c.includes('--auto'))).toBe(true)
    // github push authenticates non-interactively via the inline token URL
    expect(calls.some(c => c.includes('push') && c.includes('x-access-token:') && c.includes('@github.com/') && c.includes('GIT_TERMINAL_PROMPT=0'))).toBe(true)
  })

  it('code change → reviewer approves → auto-armed', async () => {
    const { fn } = mockShell({ changed: ['src/login.ts'] })
    const r = await runCodingTask(input, baseDeps({ shell: fn, reviewer: async () => ({ approved: true, reason: 'ok' }) }))
    expect(r.decision?.classification).toBe('code')
    expect(r.outcome).toBe('auto-armed')
  })

  it('code change → reviewer blocks → reviewer-blocked, no merge', async () => {
    const { fn, calls } = mockShell({ changed: ['src/login.ts'] })
    const r = await runCodingTask(input, baseDeps({ shell: fn, reviewer: async () => ({ approved: false, reason: 'bug' }) }))
    expect(r.outcome).toBe('reviewer-blocked')
    expect(calls.some(c => c.includes('--auto'))).toBe(false)
  })

  it('agent-judged risk → awaiting-human, never merges', async () => {
    const { fn, calls } = mockShell({ changed: ['src/login.ts'] })
    const r = await runCodingTask(input, baseDeps({ shell: fn, riskAssessor: async () => ({ risky: true, reason: 'auth' }) }))
    expect(r.outcome).toBe('awaiting-human')
    expect(r.decision?.classification).toBe('risk')
    expect(calls.some(c => c.includes('--auto'))).toBe(false)
  })

  it('config/derived risk path → awaiting-human', async () => {
    const { fn } = mockShell({ changed: ['infra/prod.tf'] })
    const r = await runCodingTask(input, baseDeps({ shell: fn }))
    expect(r.outcome).toBe('awaiting-human')
  })

  it('push failure → run-failed, never reports a PR', async () => {
    const { fn } = mockShell({ changed: ['docs/readme.md'] })
    // Make the push step fail (e.g. missing auth) — must not masquerade
    // as a successful PR / awaiting-human.
    const shell = vi.fn(async (cmd: string) => {
      if (cmd.includes('push')) return { stdout: '', stderr: 'fatal: could not read Username', exit_code: 128 }
      return fn(cmd)
    })
    const r = await runCodingTask(input, baseDeps({ shell }))
    expect(r.outcome).toBe('run-failed')
    expect(r.reason).toMatch(/push failed/)
  })

  it('no changes → run-failed (no empty PR)', async () => {
    const { fn } = mockShell({ changed: [] })
    const r = await runCodingTask(input, baseDeps({ shell: fn }))
    expect(r.outcome).toBe('run-failed')
    expect(r.reason).toMatch(/no changes/)
  })

  it('worktree create failure → run-failed', async () => {
    const { fn } = mockShell({ changed: ['x'], createExit: 1 })
    const r = await runCodingTask(input, baseDeps({ shell: fn }))
    expect(r.outcome).toBe('run-failed')
    expect(r.reason).toMatch(/worktree create failed/)
  })

  it('coding loop error → run-failed', async () => {
    const { fn } = mockShell({ changed: ['x'] })
    const r = await runCodingTask(input, baseDeps({ shell: fn, runLoopImpl: async () => ({ status: 'error', finalMessage: null, stepCount: 2, trace: [] }) }))
    expect(r.outcome).toBe('run-failed')
  })
})

describe('llm-review (fail-safe)', () => {
  function fetchReturning(json: unknown): typeof fetch {
    return (async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify(json) } }] }) })) as unknown as typeof fetch
  }
  const fetchErroring = (async () => ({ ok: false, json: async () => ({}) })) as unknown as typeof fetch

  it('risk assessor parses model verdict', async () => {
    const a = createLlmRiskAssessor(runtimeConfig, fetchReturning({ risky: true, reason: 'auth change' }))
    expect(await a({ paths: ['x'], diff: 'd' })).toMatchObject({ risky: true, reason: 'auth change' })
  })

  it('risk assessor fails safe to risky on error', async () => {
    const a = createLlmRiskAssessor(runtimeConfig, fetchErroring)
    expect((await a({ paths: ['x'], diff: 'd' })).risky).toBe(true)
  })

  it('reviewer parses + fails safe to blocked', async () => {
    const ok = createLlmReviewer(runtimeConfig, fetchReturning({ approved: true, reason: 'lgtm' }))
    expect((await ok({ prRef: 1, diff: 'd', classification: 'code' })).approved).toBe(true)
    const bad = createLlmReviewer(runtimeConfig, fetchErroring)
    expect((await bad({ prRef: 1, diff: 'd', classification: 'code' })).approved).toBe(false)
  })
})
