// Issue → task mapping (M4). Pure helpers that turn a fetched issue /
// work-item into the branch name + run prompt the coding loop uses.
// The actual fetch (forge.issue.get) and cron/webhook trigger live in
// the integration layer; these are the deterministic, testable bits.

export interface IssueRef {
  number: number | string
  title: string
  body?: string
  // 'fix' | 'feat' | 'chore' … defaults to 'fix' when absent.
  type?: string
}

const TYPE_RE = /^[a-z]{2,12}$/

export function slugify(title: string): string {
  return title
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48)
    .replace(/-$/, '')
}

export function buildBranchName(issue: IssueRef): string {
  const num = String(issue.number).replace(/\D/g, '')
  if (!num) throw new Error('issue number required')
  const type = issue.type && TYPE_RE.test(issue.type) ? issue.type : 'fix'
  const slug = slugify(issue.title) || 'task'
  return `${type}/issue-${num}-${slug}`
}

export function buildTaskPrompt(issue: IssueRef): string {
  const num = String(issue.number)
  return [
    `You are resolving issue #${num}: ${issue.title}`,
    '',
    issue.body?.trim() ? issue.body.trim() : '(no description provided)',
    '',
    'Work in the provided worktree. When done:',
    `- ensure the verification command passes (no PR on red)`,
    `- open a PR that references issue #${num}`,
    `- do not merge risk-path changes without human approval`,
  ].join('\n')
}
