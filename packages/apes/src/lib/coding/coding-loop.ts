// Coding-task orchestrator (INT-1). Ties the M1–M7 pieces into one run:
// issue → worktree → LLM coding loop → verify → PR → merge gate.
//
// Division of responsibility (deliberate):
//   - The LLM does the CODING (edit files, run the verify command). It
//     gets file.* / bash / verify tools — NOT forge.pr.merge. Even if it
//     shells `gh pr merge`, that's a high-risk grant the agent doesn't
//     hold a YOLO scope for, so it can't self-merge.
//   - The ORCHESTRATOR owns everything policy-critical: branch + worktree
//     lifecycle, opening the PR, classifying the diff, running the risk
//     assessor + reviewer gate, and arming the merge. The LLM never
//     decides whether to merge.
//
// All I/O (shell, runLoop, reviewer, riskAssessor) is injected so the
// orchestration is unit-testable without a live LLM or git.

import type { ToolDefinition } from '../agent-tools'
import type { RunOptions, RunResult, RuntimeConfig } from '../agent-runtime'
import { runLoop } from '../agent-runtime'
import { runApeShell } from '../agent-tools/ape-shell-exec'
import { buildCreateCommand, worktreePathFor } from '../agent-tools/git-worktree'
import { buildPrCreate, buildPrMerge  } from './forge'
import type { Forge } from './forge'
import type { IssueRef, BranchNaming  } from './issue-task'
import { buildBranchName, buildTaskPrompt } from './issue-task'
import { decideMerge } from './merge-policy'
import type { MergeDecision, MergePolicy, RiskAssessorFn } from './merge-policy'
import { gateMerge } from './review-gate'
import type { ReviewerFn } from './review-gate'

const DIFF_CAP = 60 * 1024

export interface ShellResult { stdout: string, stderr: string, exit_code: number }
export type ShellFn = (cmd: string, timeoutMs?: number) => Promise<ShellResult>

export interface CodingTaskInput {
  issue: IssueRef
  repo: string // URL or $HOME path
  forge: Forge
}

export interface CodingTaskDeps {
  runtimeConfig: RuntimeConfig
  // Coding tools given to the LLM (file.*, bash, verify, …) — must NOT
  // include forge.pr.merge.
  tools: ToolDefinition[]
  persona: string
  maxSteps: number
  policy: MergePolicy
  reviewer: ReviewerFn
  riskAssessor: RiskAssessorFn
  branchNaming?: BranchNaming
  // Merge strategy + auto behaviour for the PR the orchestrator opens.
  squash?: boolean
  // Injected I/O (defaults wired to production impls).
  shell?: ShellFn
  runLoopImpl?: (opts: RunOptions) => Promise<RunResult>
  log?: (line: string) => void
}

export type MergeOutcome = 'auto-armed' | 'awaiting-human' | 'reviewer-blocked' | 'run-failed'

export interface CodingTaskResult {
  branch: string
  worktree: string
  runStatus: 'ok' | 'error'
  changedFiles: string[]
  decision?: MergeDecision
  outcome: MergeOutcome
  prRef?: string
  reason: string
}

function taskIdFromIssue(issue: IssueRef): string {
  const num = String(issue.number).replace(/\D/g, '')
  return `issue-${num || 'x'}`
}

export async function runCodingTask(input: CodingTaskInput, deps: CodingTaskDeps): Promise<CodingTaskResult> {
  const shell = deps.shell ?? (async (cmd, t) => {
    const r = await runApeShell(cmd, t)
    return { stdout: r.stdout, stderr: r.stderr, exit_code: r.exit_code }
  })
  const loop = deps.runLoopImpl ?? runLoop
  const log = deps.log ?? (() => {})

  const branch = buildBranchName(input.issue, deps.branchNaming)
  const taskId = taskIdFromIssue(input.issue)
  const worktree = worktreePathFor(taskId)

  // 1. Orchestrator creates the isolated worktree (deterministic path).
  log(`[coding] creating worktree ${worktree} on ${branch}`)
  const wt = await shell(buildCreateCommand(input.repo, taskId, branch))
  if (wt.exit_code !== 0) {
    return { branch, worktree, runStatus: 'error', changedFiles: [], outcome: 'run-failed', reason: `worktree create failed: ${wt.stderr.slice(0, 300)}` }
  }

  // 2. LLM does the coding (it has file.*/bash/verify; NOT pr.merge).
  const prompt = buildTaskPrompt(input.issue, { persona: deps.persona })
  const run = await loop({
    config: deps.runtimeConfig,
    systemPrompt: deps.persona,
    userMessage: `${prompt}\n\nWorktree: ${worktree}`,
    tools: deps.tools,
    maxSteps: deps.maxSteps,
  })
  if (run.status !== 'ok') {
    return { branch, worktree, runStatus: 'error', changedFiles: [], outcome: 'run-failed', reason: `coding loop errored after ${run.stepCount} steps` }
  }

  // 3. Determine the actual diff (orchestrator, not the LLM's word).
  const namesRes = await shell(`git -C '${worktree}' add -A && git -C '${worktree}' diff --cached --name-only`)
  const changedFiles = namesRes.stdout.split('\n').map(s => s.trim()).filter(Boolean)
  if (changedFiles.length === 0) {
    return { branch, worktree, runStatus: 'ok', changedFiles: [], outcome: 'run-failed', reason: 'no changes produced — nothing to PR' }
  }
  const diffRes = await shell(`git -C '${worktree}' diff --cached`)
  const diff = diffRes.stdout.slice(0, DIFF_CAP)

  // 4. Risk + merge decision (agent judgment ∪ config/derived).
  const agentRisk = await deps.riskAssessor({ paths: changedFiles, diff })
  const decision = decideMerge(changedFiles, deps.policy, agentRisk)
  log(`[coding] decision=${decision.classification} (${decision.reason})`)

  // 5. Commit + push + open the PR (orchestrator owns this).
  await shell(`git -C '${worktree}' commit -m ${shqMsg(input.issue)} && git -C '${worktree}' push -u origin '${branch}'`)
  const prCmd = buildPrCreate({ forge: input.forge, title: prTitle(input.issue), body: prBody(input.issue), head: branch })
  const prRes = await shell(`cd '${worktree}' && ${prCmd}`)
  const prRef = (prRes.stdout.match(/\/pull\/(\d+)|!(\d+)|\bpr\/(\d+)/i)?.slice(1).find(Boolean)) ?? branch

  // 6. Merge gate. Human/risk → stop. Code → reviewer. Chore → arm.
  if (decision.needsHuman) {
    return { branch, worktree, runStatus: 'ok', changedFiles, decision, outcome: 'awaiting-human', prRef, reason: decision.reason }
  }
  const gate = await gateMerge(decision, { prRef, diff }, deps.reviewer)
  if (!gate.armMerge) {
    return { branch, worktree, runStatus: 'ok', changedFiles, decision, outcome: 'reviewer-blocked', prRef, reason: gate.reason }
  }
  // Arm merge-when-green (never bypasses required checks — branch protection).
  const mergeCmd = buildPrMerge({ forge: input.forge, ref: prRef, auto: true, squash: deps.squash, deleteBranch: true })
  await shell(`cd '${worktree}' && ${mergeCmd}`)
  return { branch, worktree, runStatus: 'ok', changedFiles, decision, outcome: 'auto-armed', prRef, reason: gate.reason }
}

// Local helpers (kept here so the file is self-contained).
function prTitle(issue: IssueRef): string {
  return `${issue.type ?? 'fix'}: ${issue.title} (#${String(issue.number).replace(/\D/g, '')})`
}
function prBody(issue: IssueRef): string {
  return `Resolves #${String(issue.number).replace(/\D/g, '')}.\n\nAutomated by the OpenApe coding agent.`
}
function shqMsg(issue: IssueRef): string {
  return `'${prTitle(issue).replace(/'/g, '\'\\\'\'')}'`
}
