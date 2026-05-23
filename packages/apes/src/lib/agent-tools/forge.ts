import type { ToolDefinition } from './index'
import type { Forge } from '../coding/forge'
import { runApeShell } from './ape-shell-exec'
import { buildIssueGet, buildPrCreate, buildPrMerge, buildPrStatus, detectForge } from '../coding/forge'

// Resolve the forge from an explicit param or a remote URL. The
// recipe/orchestration usually passes `forge` directly; `remote` is the
// auto-detect fallback (git remote get-url origin). Any registered
// adapter id is accepted (github/azure built-in, plus anything added via
// registerForge) — getForge() validates downstream.
function resolveForge(a: { forge?: unknown, remote?: unknown }): Forge {
  if (typeof a.forge === 'string' && a.forge !== '') return a.forge
  if (typeof a.remote === 'string') return detectForge(a.remote)
  throw new Error('provide a forge id (e.g. github, azure, or a registered adapter) or a remote URL to detect it')
}

const forgeParam = { type: 'string', description: 'Target forge id (github, azure, or a registered adapter). Omit to auto-detect from `remote`.' }
const remoteParam = { type: 'string', description: 'git remote URL — used to auto-detect the forge when `forge` is omitted.' }

export const forgeTools: ToolDefinition[] = [
  {
    name: 'forge.pr.create',
    description: 'Open a pull request on GitHub (gh) or Azure DevOps (az). Gated via the DDISA grant cycle. Provider chosen by `forge` or auto-detected from `remote`.',
    parameters: {
      type: 'object',
      properties: {
        forge: forgeParam,
        remote: remoteParam,
        title: { type: 'string', description: 'PR title.' },
        body: { type: 'string', description: 'PR description / body.' },
        head: { type: 'string', description: 'Source branch.' },
        base: { type: 'string', description: 'Target branch. Omit for the repo default.' },
      },
      required: ['title', 'body', 'head'],
    },
    execute: async (args: unknown) => {
      const a = args as { forge?: unknown, remote?: unknown, title: string, body: string, head: string, base?: string }
      const cmd = buildPrCreate({ forge: resolveForge(a), title: a.title, body: a.body, head: a.head, base: a.base })
      return await runApeShell(cmd)
    },
  },
  {
    name: 'forge.pr.merge',
    description: 'Merge a PR — or with auto=true, arm "merge when checks pass" (gh --auto / az auto-complete) so the platform merges only on green CI. Gated. Never bypasses required checks (branch protection is the server-side gate).',
    parameters: {
      type: 'object',
      properties: {
        forge: forgeParam,
        remote: remoteParam,
        ref: { type: 'string', description: 'GitHub: PR number or branch. Azure: PR id.' },
        auto: { type: 'boolean', description: 'Arm merge-when-green instead of immediate merge. Recommended.' },
        squash: { type: 'boolean', description: 'Squash-merge. Default true.' },
        delete_branch: { type: 'boolean', description: 'Delete the source branch after merge.' },
      },
      required: ['ref'],
    },
    execute: async (args: unknown) => {
      const a = args as { forge?: unknown, remote?: unknown, ref: string, auto?: boolean, squash?: boolean, delete_branch?: boolean }
      const cmd = buildPrMerge({ forge: resolveForge(a), ref: a.ref, auto: a.auto, squash: a.squash, deleteBranch: a.delete_branch })
      return await runApeShell(cmd)
    },
  },
  {
    name: 'forge.pr.status',
    description: 'Fetch a PR\'s state + checks + review decision. Gated (read).',
    parameters: {
      type: 'object',
      properties: { forge: forgeParam, remote: remoteParam, ref: { type: 'string', description: 'PR number/branch (GitHub) or id (Azure).' } },
      required: ['ref'],
    },
    execute: async (args: unknown) => {
      const a = args as { forge?: unknown, remote?: unknown, ref: string }
      return await runApeShell(buildPrStatus(resolveForge(a), a.ref))
    },
  },
  {
    name: 'forge.issue.get',
    description: 'Fetch an issue (GitHub) or work-item (Azure) — title, body, labels. Gated (read). Use to turn an assigned task into a coding run.',
    parameters: {
      type: 'object',
      properties: { forge: forgeParam, remote: remoteParam, ref: { type: 'string', description: 'Issue number (GitHub) or work-item id (Azure).' } },
      required: ['ref'],
    },
    execute: async (args: unknown) => {
      const a = args as { forge?: unknown, remote?: unknown, ref: string }
      return await runApeShell(buildIssueGet(resolveForge(a), a.ref))
    },
  },
]
