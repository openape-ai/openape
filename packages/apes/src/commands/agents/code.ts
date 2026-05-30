import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import { defineCommand } from 'citty'
import { consola } from 'consola'
import type { RuntimeConfig } from '../../lib/agent-runtime'
import { taskTools } from '../../lib/agent-tools'
import { runApeShell } from '../../lib/agent-tools/ape-shell-exec'
import { materializeSecrets } from '../../lib/agent-secrets-runtime'
import { runCodingTask } from '../../lib/coding/coding-loop'
import { buildIssueGet, detectForge } from '../../lib/coding/forge'
import type { Forge } from '../../lib/coding/forge'
import type { IssueRef } from '../../lib/coding/issue-task'
import { createLlmReviewer, createLlmRiskAssessor } from '../../lib/coding/llm-review'
import { resolveMergePolicy } from '../../lib/coding/derive-policy'

class CliError extends Error {}

// The LLM toolset for coding — file.*/bash/verify + read-only forge.
// Deliberately NO forge.pr.merge (the orchestrator owns merge).
const CODING_TOOLS = ['file.read', 'file.write', 'file.edit', 'bash', 'git.worktree', 'verify', 'forge.issue.get', 'forge.pr.status']

const DEFAULT_PERSONA = [
  'You are an autonomous coding agent. You implement an assigned issue in',
  'the provided git worktree: read the relevant code, make small targeted',
  'edits with file.edit, and make the repo verification command pass via',
  'the verify tool. Do not open or merge PRs — the orchestrator does that.',
  'No change is done until verify is green.',
].join(' ')

function readLitellmConfig(model?: string): RuntimeConfig {
  const env: Record<string, string> = {}
  const envPath = join(homedir(), 'litellm', '.env')
  if (existsSync(envPath)) {
    for (const raw of readFileSync(envPath, 'utf8').split('\n')) {
      const line = raw.trim()
      const m = /^([A-Z_][A-Z0-9_]*)=(.*)$/.exec(line)
      if (m) env[m[1]!] = m[2]!.trim().replace(/^["']|["']$/g, '')
    }
  }
  for (const k of ['LITELLM_API_KEY', 'LITELLM_MASTER_KEY', 'LITELLM_BASE_URL']) {
    if (process.env[k]) env[k] = process.env[k]!
  }
  const apiBase = (env.LITELLM_BASE_URL || 'http://127.0.0.1:4000/v1').replace(/\/$/, '')
  // A LiteLLM proxy bound to loopback can run keyless (any local process
  // already has host access), so a localhost base URL needs no token — the
  // proxy ignores the Authorization header. This lets an agent run with no
  // litellm config at all (the default base is loopback). A remote base
  // URL still requires a key.
  const isLoopback = /^https?:\/\/(?:127\.0\.0\.1|localhost|\[::1\])(?::\d+)?(?:\/|$)/.test(apiBase)
  const apiKey = env.LITELLM_API_KEY || env.LITELLM_MASTER_KEY || (isLoopback ? 'sk-loopback-noauth' : '')
  if (!apiKey) throw new CliError('No LITELLM_API_KEY / LITELLM_MASTER_KEY for non-loopback LITELLM_BASE_URL.')
  return { apiBase, apiKey, model: model || process.env.APE_CHAT_BRIDGE_MODEL || 'claude-haiku-4-5' }
}

function readPersona(file?: string): string {
  if (file && existsSync(file)) return readFileSync(file, 'utf8')
  const agentJson = join(homedir(), '.openape', 'agent', 'agent.json')
  if (existsSync(agentJson)) {
    try {
      const p = JSON.parse(readFileSync(agentJson, 'utf8')) as { systemPrompt?: string }
      if (p.systemPrompt?.trim()) return p.systemPrompt
    }
    catch { /* fall through */ }
  }
  return DEFAULT_PERSONA
}

async function fetchIssue(forge: Forge, ref: string, repo: string): Promise<IssueRef> {
  // Pass repo explicitly: fetchIssue runs before the clone, so the CWD is
  // not the target repo and `gh issue view` would otherwise fail.
  const res = await runApeShell(buildIssueGet(forge, ref, repo))
  if (res.exit_code !== 0) throw new CliError(`could not fetch issue ${ref}: ${(res.stderr || res.stdout).slice(0, 200)}`)
  const j = JSON.parse(res.stdout) as { number?: number, id?: number, title?: string, fields?: { 'System.Title'?: string }, body?: string }
  const number = j.number ?? j.id ?? Number(ref)
  const title = j.title ?? j.fields?.['System.Title'] ?? `issue ${ref}`
  return { number, title, body: j.body }
}

export const codeAgentCommand = defineCommand({
  meta: {
    name: 'code',
    description: 'Run a coding task: issue to worktree to edit to verify to PR (policy-gated merge). The agent never self-merges.',
  },
  args: {
    'issue': { type: 'string', description: 'Issue / work-item ref to work on.' },
    'repo': { type: 'string', description: 'Git remote URL of the target repo.', required: true },
    'forge': { type: 'string', description: 'github | azure | registered forge. Auto-detected from --repo if omitted.' },
    'model': { type: 'string', description: 'Override LLM model.' },
    'max-steps': { type: 'string', description: 'Max tool-call rounds (default 40).' },
    'persona-file': { type: 'string', description: 'File with the agent persona/system prompt.' },
    'poll-label': { type: 'string', description: 'Poll mode: work all open issues with this label.' },
  },
  async run({ args }) {
    const repo = args.repo as string
    const forge: Forge = (args.forge as string) || detectForge(repo)

    // Inject sealed capability secrets (e.g. GH_TOKEN / AZ_PAT) into this
    // process's env so the forge CLIs we shell out to are authenticated.
    // The cron-runner invokes us as the agent user, so the blobs + the
    // X25519 key in ~/.config/openape are readable. Best-effort: no key /
    // no blobs just means nothing to inject. Without this, `gh` runs
    // unauthenticated and silently returns an empty issue list.
    try {
      const { applied } = materializeSecrets()
      if (applied.length > 0) consola.info(`Capabilities available: ${applied.join(', ')}`)
    }
    catch { /* no secrets to materialize */ }
    const config = readLitellmConfig(args.model as string | undefined)
    const persona = readPersona(args['persona-file'] as string | undefined)
    const maxSteps = Number(args['max-steps']) > 0 ? Number(args['max-steps']) : 40
    const tools = taskTools(CODING_TOOLS)

    // streamAggregate: the chatgpt-OAuth provider in LiteLLM 1.84+
    // returns an empty body on non-stream chat/completions (the bug
    // routes the upstream call through the responses API but never
    // aggregates the SSE deltas back). Streaming + local aggregate
    // works with every provider LiteLLM ships, and the apes runtime
    // joins the deltas into the same shape the non-stream code path
    // expects — same downstream behaviour. Opt in via
    // OPENAPE_STREAM_AGGREGATE=1 (defaults on for the container coder
    // where ChatGPT-OAuth is the standard route).
    const streamAggregate = (process.env.OPENAPE_STREAM_AGGREGATE ?? '1') !== '0'

    const deps = {
      runtimeConfig: config,
      tools,
      persona,
      maxSteps,
      resolvePolicy: (worktree: string) => resolveMergePolicy(worktree),
      reviewer: createLlmReviewer(config),
      riskAssessor: createLlmRiskAssessor(config),
      log: (l: string) => consola.info(l),
      streamAggregate,
    }

    // Determine the issue list (single or poll).
    const refs: string[] = []
    if (args['poll-label']) {
      const slug = repo.replace(/^https:\/\/github\.com\//, '').replace(/\.git$/, '')
      const list = await runApeShell(`gh issue list --repo ${slug} --label '${args['poll-label']}' --state open --json number --jq '.[].number'`)
      if (list.exit_code !== 0) {
        throw new CliError(`gh issue list failed (exit ${list.exit_code}): ${(list.stderr || list.stdout).slice(0, 300)}`)
      }
      // `gh` exits 0 with empty stdout when it is unauthenticated, which
      // would otherwise look identical to "no matching issues". Detect that
      // explicitly so a missing GH_TOKEN is a loud error, not a silent no-op.
      if (list.stdout.trim() === '' && /gh auth login|GH_TOKEN/i.test(list.stderr)) {
        throw new CliError('gh is not authenticated (no GH_TOKEN). The agent\'s GH_TOKEN capability is not materialized — bind it via the deploy/secrets flow.')
      }
      // Keep only numeric issue ids — defensive against any stray line.
      refs.push(...list.stdout.split('\n').map(s => s.trim()).filter(s => /^\d+$/.test(s)))
      if (refs.length === 0) { consola.info('no open issues with that label'); return }
    }
    else if (args.issue) {
      refs.push(args.issue as string)
    }
    else {
      throw new CliError('provide --issue <ref> or --poll-label <label>')
    }

    for (const ref of refs) {
      const issue = await fetchIssue(forge, ref, repo)
      consola.start(`coding issue #${issue.number}: ${issue.title}`)
      const result = await runCodingTask({ issue, repo, forge }, deps)
      consola.box(`#${issue.number} -> ${result.outcome}\nPR: ${result.prRef ?? '(none)'}\n${result.reason}`)
    }
  },
})
