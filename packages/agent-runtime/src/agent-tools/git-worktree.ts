import { homedir } from 'node:os'
import { resolve } from 'node:path'
import process from 'node:process'
import type { ToolDefinition } from './index'
import { runApeShell } from './ape-shell-exec'

// Worktree + clone roots. Default to ~/work and ~/repos but are
// configurable per deployment via OPENAPE_CODING_WORK_DIR /
// OPENAPE_CODING_REPOS_DIR (set by the recipe/nest). Must stay under
// $HOME — the OS-confinement boundary the whole coding sandbox relies on.
function jailedRoot(envVar: string, fallbackName: string): string {
  const home = homedir()
  const raw = process.env[envVar]
  const dir = raw ? resolve(raw) : resolve(home, fallbackName)
  if (dir !== home && !dir.startsWith(`${home}/`)) {
    throw new Error(`${envVar} (${dir}) must resolve inside the agent's home`)
  }
  return dir
}

function workRoot(): string {
  return jailedRoot('OPENAPE_CODING_WORK_DIR', 'work')
}

function reposRoot(): string {
  return jailedRoot('OPENAPE_CODING_REPOS_DIR', 'repos')
}

// Worktree lifecycle for the coding agent. All git invocations go
// through the gated ape-shell path (runApeShell) — `git worktree add`
// is a sandbox-leaving op, so it hits the DDISA grant / git-shape
// matcher exactly like a terminal `apes run -- git …`.
//
// Layout (all under the agent's $HOME, OS-confined):
//   ~/repos/<base>      cached bare-ish clone, one per repo
//   ~/work/<task_id>    the per-task worktree the agent edits in
//
// Inputs are strictly validated + single-quoted before reaching the
// shell. The charset rules reject quotes/metacharacters outright, so
// the single-quoting can't be broken out of.

const TASK_ID_RE = /^[\w.-]{1,64}$/
const BRANCH_RE = /^[\w./-]{1,128}$/
// Either an https/git remote URL, or a path (validated as jailed below).
const URL_RE = /^(?:https:\/\/|git@)[\w@:/.-]{3,256}$/

function assertTaskId(v: unknown): string {
  if (typeof v !== 'string' || !TASK_ID_RE.test(v)) {
    throw new Error('task_id must match ^[a-zA-Z0-9._-]{1,64}$')
  }
  return v
}

function assertBranch(v: unknown): string {
  if (typeof v !== 'string' || !BRANCH_RE.test(v)) {
    throw new Error('branch must match ^[A-Za-z0-9._/-]{1,128}$')
  }
  return v
}

// Resolve a repo reference to a base-clone dir + a clonable source.
// URL → clone into ~/repos/<derived>. Local path → must be a git repo
// already inside $HOME (jailed); used in place.
function resolveRepo(repo: unknown): { source: string; baseDir: string; isUrl: boolean } {
  if (typeof repo !== 'string' || repo === '') {
    throw new Error('repo must be a non-empty string (URL or path under $HOME)')
  }
  const home = homedir()
  if (URL_RE.test(repo)) {
    const tail = repo.replace(/\.git$/, '').replace(/[/:]+$/, '')
    const parts = tail.split(/[/:]/).filter(Boolean).slice(-2)
    const base = parts.join('-').replace(/[^\w.-]/g, '')
    if (!base) throw new Error('could not derive a clone name from repo URL')
    return { source: repo, baseDir: resolve(reposRoot(), base), isUrl: true }
  }
  // Local path — jail under $HOME.
  const candidate = repo.startsWith('~/') ? resolve(home, repo.slice(2)) : resolve(home, repo)
  if (candidate !== home && !candidate.startsWith(`${home}/`)) {
    throw new Error(`repo path "${repo}" resolves outside the agent's home`)
  }
  return { source: candidate, baseDir: candidate, isUrl: false }
}

export function worktreePathFor(taskId: string): string {
  return resolve(workRoot(), assertTaskId(taskId))
}

const q = (s: string): string => `'${s}'` // safe: callers validate charset first

export function buildCreateCommand(repo: unknown, taskId: string, branch: string): string {
  const id = assertTaskId(taskId)
  const br = assertBranch(branch)
  const { source, baseDir, isUrl } = resolveRepo(repo)
  const wt = worktreePathFor(id)
  const clone = isUrl
    ? `if [ ! -d ${q(baseDir)}/.git ]; then git clone ${q(source)} ${q(baseDir)}; fi`
    : `test -d ${q(baseDir)}/.git`
  // A polling agent re-attempts the same issue (same task id → same branch
  // + worktree path) on every tick, so creation must be idempotent: tear
  // down any leftover worktree from a prior run, then add fresh with `-B`
  // (create-or-reset the branch). The cleanup group never fails the chain.
  const reset = [
    `git -C ${q(baseDir)} worktree remove --force ${q(wt)} 2>/dev/null || true`,
    `git -C ${q(baseDir)} worktree prune 2>/dev/null || true`,
    `rm -rf ${q(wt)} 2>/dev/null || true`,
  ].join('; ')
  // Non-interactive GitHub auth for the clone (shared by all its worktrees).
  // A spawned agent's git defaults to credential.helper=osxkeychain, which
  // hangs headless (no GUI) — so ANY `git push` the LLM runs itself would
  // block. Point credential.helper at $GH_TOKEN (read from the gated shell's
  // env at push time, never stored) so every git operation authenticates
  // without a prompt. GitHub-only; other forges keep their default helper.
  // First RESET the helper list (the empty value clears the inherited
  // osxkeychain helper — otherwise git still calls it on `store` and hangs
  // headless), then add ours that supplies $GH_TOKEN from the env.
  const ghAuth = /github\.com/i.test(source)
    ? `git -C ${q(baseDir)} config credential.helper '' && git -C ${q(baseDir)} config --add credential.helper '!f() { echo username=x-access-token; echo "password=$GH_TOKEN"; }; f'`
    : 'true'
  return [
    `mkdir -p ${q(reposRoot())} ${q(workRoot())}`,
    clone,
    ghAuth,
    `git -C ${q(baseDir)} fetch --quiet || true`,
    `{ ${reset}; }`,
    `git -C ${q(baseDir)} worktree add -B ${q(br)} ${q(wt)}`,
    `echo ${q(wt)}`,
  ].join(' && ')
}

function buildRemoveCommand(repo: unknown, taskId: string): string {
  const id = assertTaskId(taskId)
  const { baseDir } = resolveRepo(repo)
  const wt = worktreePathFor(id)
  return `git -C ${q(baseDir)} worktree remove --force ${q(wt)} && git -C ${q(baseDir)} worktree prune`
}

function buildListCommand(): string {
  return `ls -1 ${q(workRoot())} 2>/dev/null || true`
}

export const gitWorktreeTools: ToolDefinition[] = [
  {
    name: 'git.worktree',
    description: 'Manage isolated git worktrees for coding tasks. action=create clones the repo (cached under ~/repos) and adds a fresh worktree under ~/work/<task_id> on a new branch. action=remove tears it down. action=list shows current task worktrees. Git operations go through the DDISA grant cycle (git-shape).',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['create', 'remove', 'list'], description: 'create | remove | list' },
        repo: { type: 'string', description: 'For create/remove: git remote URL (https/git@) or a path under $HOME to an existing clone.' },
        task_id: { type: 'string', description: 'For create/remove: identifier for the worktree, ^[a-zA-Z0-9._-]{1,64}$. The worktree lands at ~/work/<task_id>.' },
        branch: { type: 'string', description: 'For create: new branch name, ^[A-Za-z0-9._/-]{1,128}$.' },
      },
      required: ['action'],
    },
    execute: async (args: unknown) => {
      const a = args as { action?: unknown, repo?: unknown, task_id?: unknown, branch?: unknown }
      let cmd: string
      if (a.action === 'create') {
        if (typeof a.branch !== 'string') throw new Error('branch is required for action=create')
        cmd = buildCreateCommand(a.repo, assertTaskId(a.task_id), a.branch)
      }
      else if (a.action === 'remove') {
        cmd = buildRemoveCommand(a.repo, assertTaskId(a.task_id))
      }
      else if (a.action === 'list') {
        cmd = buildListCommand()
      }
      else {
        throw new Error('action must be one of: create, remove, list')
      }
      const res = await runApeShell(cmd)
      return {
        action: a.action,
        ...(a.action !== 'list' ? { worktree: worktreePathFor(assertTaskId(a.task_id)) } : {}),
        stdout: res.stdout,
        stderr: res.stderr,
        exit_code: res.exit_code,
        ...(res.error ? { error: res.error, hint: res.hint } : {}),
      }
    },
  },
]

export const _internal = { resolveRepo, worktreePathFor, buildCreateCommand, buildRemoveCommand, buildListCommand, assertTaskId, assertBranch }
