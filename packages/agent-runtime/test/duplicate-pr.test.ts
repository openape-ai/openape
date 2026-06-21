import { describe, expect, it, vi } from 'vitest'
import { runCodingTask } from '../src/coding/coding-loop'
import type { CodingTaskDeps, ShellResult } from '../src/coding/coding-loop'
import type { MergePolicy } from '../src/coding/merge-policy'
import { createLlmReviewer, createLlmRiskAssessor } from '../src/coding/llm-review'

const runtimeConfig = { apiBase: 'http://x/v1', apiKey: 'k', model: 'm' }
const POLICY: MergePolicy = { autoMergeEnabled: true, autoPaths: ['**/*.md'], riskPaths: ['infra/**'] }

// Mock shell: pattern-match the command, return canned results. Records
// every command for assertions.
function mockShell(opts: { changed: string[], createExit?: number, prListResponse?: string, existingPrNumber?: number }) {
  const calls: string[] = []
  let prCreateCount = 0
  const fn = vi.fn(async (cmd: string): Promise<ShellResult> => {
    calls.push(cmd)
    if (cmd.includes('worktree add')) return { stdout: '', stderr: '', exit_code: opts.createExit ?? 0 }
    if (cmd.includes('diff --cached --name-only')) return { stdout: opts.changed.join('\n'), stderr: '', exit_code: 0 }
    if (cmd.includes('diff --cached')) return { stdout: 'some diff', stderr: '', exit_code: 0 }
    if (cmd.includes('pr list') || cmd.includes('pr list --json')) {
      // Return existing PR if prListResponse is provided
      return { stdout: opts.prListResponse || '', stderr: '', exit_code: 0 }
    }
    if (cmd.includes('pr create') || cmd.includes('repos pr create')) {
      prCreateCount++
      const prNum = opts.existingPrNumber || 77
      return { stdout: `https://github.com/o/r/pull/${prNum}`, stderr: '', exit_code: 0 }
    }
    return { stdout: '', stderr: '', exit_code: 0 }
  })
  return { fn, calls, getPrCreateCount: () => prCreateCount }
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

describe('Duplicate PR prevention', () => {
  it('should check for existing PR before creating a new one', async () => {
    const { fn, calls } = mockShell({ changed: ['src/login.ts'] })
    const r = await runCodingTask(input, baseDeps({ shell: fn }))
    
    // The coding agent MUST check for existing PRs before creating a new one
    // This test fails because the current implementation does NOT check for existing PRs
    const prListCalls = calls.filter(c => c.includes('pr list') || c.includes('pr list --json'))
    expect(prListCalls.length).toBeGreaterThan(0)
  })

  it('should NOT create duplicate PR if one already exists for the same issue', async () => {
    // Simulate an existing PR for issue #42
    const existingPrJson = JSON.stringify([
      { number: 43, head: 'issue-42-fix-login', state: 'open', title: 'fix: Fix login (#42)' }
    ])
    const { fn, calls, getPrCreateCount } = mockShell({ 
      changed: ['src/login.ts'],
      prListResponse: existingPrJson
    })
    
    const r = await runCodingTask(input, baseDeps({ shell: fn }))
    
    // Count how many times pr create was called
    const prCreateCalls = calls.filter(c => c.includes('pr create') || c.includes('repos pr create'))
    
    // If an existing PR exists, it should NOT create a new one
    expect(prCreateCalls.length).toBe(0)
    expect(getPrCreateCount()).toBe(0)
  })
})
