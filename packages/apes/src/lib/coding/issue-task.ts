// Issue → task mapping (M4). Pure helpers that turn a fetched issue /
// work-item into the branch name + run prompt the coding loop uses.
//
// Neither the branch convention nor the prompt/persona is hard-coded
// policy: the branch name is a configurable TEMPLATE and the prompt is
// composed from a recipe-supplied PERSONA. The fallbacks are neutral
// (overridable), not team-specific opinions baked into the library.

export interface IssueRef {
  number: number | string
  title: string
  body?: string
  // 'fix' | 'feat' | 'chore' … used by the {type} placeholder.
  type?: string
}

export interface BranchNaming {
  // Template with {type} {number} {slug} placeholders. Repo/recipe-
  // supplied; the fallback is a neutral convention, not a mandate.
  template?: string
  // Fallback type when the issue carries none.
  defaultType?: string
  // Max slug length (forge/CI branch-length limits vary).
  slugMax?: number
}

export interface TaskFraming {
  // The agent's persona/instructions from its recipe — prepended so the
  // task prompt reflects THIS agent, not a hard-coded English script.
  persona?: string
  // Override the default closing instructions entirely.
  instructions?: string
}

const DEFAULT_TEMPLATE = '{type}/issue-{number}-{slug}'
const DEFAULT_TYPE = 'fix'
const DEFAULT_SLUG_MAX = 48

// Minimal, provider-neutral closing instructions. Overridable via
// TaskFraming.instructions; the recipe persona carries the real voice.
const DEFAULT_INSTRUCTIONS = [
  'Work in the provided worktree. When done:',
  '- ensure the verification command passes (no PR on red)',
  '- open a PR that references this issue',
  '- leave risk-path / agent-judged-risky changes for human approval',
].join('\n')

const TYPE_RE = /^[a-z]{2,12}$/

export function slugify(title: string, max: number = DEFAULT_SLUG_MAX): string {
  return title
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, max)
    .replace(/-$/, '')
}

export function buildBranchName(issue: IssueRef, naming: BranchNaming = {}): string {
  const num = String(issue.number).replace(/\D/g, '')
  if (!num) throw new Error('issue number required')
  const type = issue.type && TYPE_RE.test(issue.type)
    ? issue.type
    : (naming.defaultType ?? DEFAULT_TYPE)
  const slug = slugify(issue.title, naming.slugMax ?? DEFAULT_SLUG_MAX) || 'task'
  return (naming.template ?? DEFAULT_TEMPLATE)
    .replace(/\{type\}/g, type)
    .replace(/\{number\}/g, num)
    .replace(/\{slug\}/g, slug)
}

export function buildTaskPrompt(issue: IssueRef, framing: TaskFraming = {}): string {
  const num = String(issue.number)
  const parts: string[] = []
  if (framing.persona?.trim()) parts.push(framing.persona.trim())
  parts.push(`Issue #${num}: ${issue.title}`)
  parts.push(issue.body?.trim() ? issue.body.trim() : '(no description provided)')
  parts.push(framing.instructions?.trim() ? framing.instructions.trim() : DEFAULT_INSTRUCTIONS)
  return parts.join('\n\n')
}
