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
import { buildPrCreate, buildPrMerge, buildPrList } from './forge'
import type { Forge } from './forge'
import type { IssueRef, BranchNaming  } from './issue-task'
import { buildBranchName, buildTaskPrompt } from './issue-task'
import { decideMerge, SECURE_DEFAULT_POLICY } from './merge-policy'
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
  // Static policy, OR resolvePolicy to load it from the cloned worktree
  // (e.g. the repo's .openape/coding.json + derived signals). When both
  // are absent the secure default applies (auto-merge off).
  policy?: MergePolicy
  resolvePolicy?: (worktree: string) => Promise<MergePolicy>
  reviewer: ReviewerFn
  riskAssessor: RiskAssessorFn
  branchNaming?: BranchNaming
  // Merge strategy + auto behaviour for the PR the orchestrator opens.
  squash?: boolean
  // Injected I/O (defaults wired to production impls).
  shell?: ShellFn
  runLoopImpl?: (opts: RunOptions) => Promise<RunResult>
  log?: (line: string) => void
  // Forwarded to runLoop — enables SSE stream + local aggregate. Set
  // by the container coder to work around LiteLLM's chatgpt-OAuth
  // non-stream bug. See RunOptions.streamAggregate.
  streamAggregate?: boolean
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

  // Resolve the merge policy from the cloned repo (config + derived
  // signals), or use the static one, or the secure default.
  const policy = deps.resolvePolicy
    ? await deps.resolvePolicy(worktree)
    : (deps.policy ?? SECURE_DEFAULT_POLICY)

  // 2. LLM does the coding (it has file.*/bash/verify; NOT pr.merge).
  const prompt = buildTaskPrompt(input.issue, { persona: deps.persona })
  const run = await loop({
    config: deps.runtimeConfig,
    systemPrompt: deps.persona,
    userMessage: `${prompt}\n\nWorktree: ${worktree}`,
    tools: deps.tools,
    maxSteps: deps.maxSteps,
    streamAggregate: deps.streamAggregate,
  })
  // Dump the LLM/tool trace when OPENAPE_VERBOSE_TRACE is set — useful
  // when a coder run produces "no changes" and we need to see exactly
  // which tool calls the LLM attempted + which failed.
  if (process.env.OPENAPE_VERBOSE_TRACE === '1') {
    for (const t of run.trace) {
      log(`[trace] step=${t.step} type=${t.type}${t.tool ? ` tool=${t.tool}` : ''} ${t.preview}`)
    }
  }
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
  const decision = decideMerge(changedFiles, policy, agentRisk)
  log(`[coding] decision=${decision.classification} (${decision.reason})`)

  // 5. Commit + push + open the PR (orchestrator owns this). Each step is
  //    checked: a freshly-spawned agent has no git identity and `git push`
  //    over HTTPS needs the forge token, so a silent failure here must NOT
  //    masquerade as a successful PR. Identity is a commit-author default
  //    (overridable via GIT_AUTHOR_*); push auth rides the gh credential
  //    helper, which reads the materialized GH_TOKEN from the env.
  const authorEmail = process.env.GIT_AUTHOR_EMAIL || 'coding-agent@openape.ai'
  const authorName = process.env.GIT_AUTHOR_NAME || 'OpenApe Coding Agent'
  const ident = `-c user.email='${authorEmail.replace(/'/g, '')}' -c user.name='${authorName.replace(/'/g, '')}'`
  const commitRes = await shell(`git -C '${worktree}' ${ident} commit -m ${shqMsg(input.issue)}`)
  if (commitRes.exit_code !== 0) {
    return { branch, worktree, runStatus: 'ok', changedFiles, decision, outcome: 'run-failed', prRef: branch, reason: `commit failed: ${(commitRes.stderr || commitRes.stdout).slice(0, 300)}` }
  }
  // Push with the capability token inline so it authenticates without an
  // interactive credential prompt (the gh credential helper doesn't reach
  // through the gated shell reliably). GIT_TERMINAL_PROMPT=0 makes a missing
  // credential fail fast instead of hanging. `$GH_TOKEN` is expanded by the
  // gated shell, where the materialized token lives — it never appears in
  // this process's argv. Non-GitHub forges keep their own CLI auth (origin).
  const pushRes = await shell(buildPushCommand(input.forge, input.repo, worktree, branch))
  if (pushRes.exit_code !== 0) {
    return { branch, worktree, runStatus: 'ok', changedFiles, decision, outcome: 'run-failed', prRef: branch, reason: `push failed: ${(pushRes.stderr || pushRes.stdout).slice(0, 300)}` }
  }
  // 5a. Check for existing PR before creating a new one
  const prListCmd = buildPrList(input.forge, 'open')
  const prListRes = await shell(`cd '${worktree}' && ${prListCmd}`)
  let existingPrRef: string | undefined
  if (prListRes.exit_code === 0 && prListRes.stdout.trim()) {
    try {
      const prs = JSON.parse(prListRes.stdout)
      // Look for an existing PR with the same issue number in the title or body
      const issueNum = String(input.issue.number).replace(/\D/g, '')
      const existingPr = prs.find((pr: any) => {
        const title = pr.title || ''
        const body = pr.body || ''
        return title.includes(`(#${issueNum})`) || title.includes(`#${issueNum}`) || body.includes(`#${issueNum}`)
      })
      if (existingPr) {
        existingPrRef = String(existingPr.number)
        log(`[coding] found existing PR #${existingPrRef} for issue #${input.issue.number}, reusing it`)
      }
    } catch (e) {
      log(`[coding] failed to parse PR list: ${e}`)
      // Continue to create a new PR if we can't parse the list
    }
  }

  // Create PR only if no existing PR was found
  let prRef: string
  if (existingPrRef) {
    prRef = existingPrRef
  } else {
    const prCmd = buildPrCreate({ forge: input.forge, title: prTitle(input.issue), body: prBody(input.issue), head: branch })
    const prRes = await shell(`cd '${worktree}' && ${prCmd}`)
    if (prRes.exit_code !== 0) {
      return { branch, worktree, runStatus: 'ok', changedFiles, decision, outcome: 'run-failed', prRef: branch, reason: `pr create failed: ${(prRes.stderr || prRes.stdout).slice(0, 300)}` }
    }
    prRef = (prRes.stdout.match(/\/pull\/(\d+)|!(\d+)|\bpr\/(\d+)/i)?.slice(1).find(Boolean)) ?? branch
  }

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

// Non-interactive authenticated push. GitHub: inline the capability token
// (double-quoted so the gated shell — not this process — expands $GH_TOKEN;
// it never lands in argv or .git/config). Other forges keep their CLI's own
// auth via `origin`. GIT_TERMINAL_PROMPT=0 turns a missing credential into a
// fast failure instead of a hang on a credential prompt.
function buildPushCommand(forge: string, repo: string, worktree: string, branch: string): string {
  // `-c credential.helper=` disables ALL credential helpers for this push.
  // The token URL already authenticates, so no helper is needed for `get`;
  // critically it also stops git from calling the inherited osxkeychain
  // helper on `store` after a successful push, which hangs headless (no GUI
  // for the agent user). GIT_TERMINAL_PROMPT=0 makes a missing credential a
  // fast failure rather than a prompt-hang.
  const base = `GIT_TERMINAL_PROMPT=0 git -C '${worktree}' -c credential.helper=`
  if (forge === 'github') {
    const slug = repo.replace(/^[a-z]+:\/\/[^/]+\//i, '').replace(/\.git$/, '').replace(/['"\s]/g, '')
    return `${base} push "https://x-access-token:\${GH_TOKEN}@github.com/${slug}.git" '${branch}'`
  }
  return `${base} push -u origin '${branch}'`
}
