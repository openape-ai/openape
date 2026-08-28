/**
 * Clone command shown on the repo page. The DDISA token lives in the file
 * `apes login` writes — there is no `apes token` subcommand (M1 lesson).
 */
export function cloneCommand(origin: string, owner: string, name: string): string {
  const host = origin.replace(/^https?:\/\//, '')
  return `git clone https://x-access-token:$(jq -r .access_token ~/.config/apes/auth.json)@${host}/${owner}/${name}.git`
}

/** Icon and color for a CI status badge (M5). */
export function statusLook(state: 'pending' | 'success' | 'failure'): { icon: string, class: string } {
  if (state === 'success') return { icon: 'i-lucide-check-circle-2', class: 'text-emerald-500' }
  if (state === 'failure') return { icon: 'i-lucide-x-circle', class: 'text-red-500' }
  return { icon: 'i-lucide-loader-circle', class: 'text-amber-500' }
}

/** Default owner namespace derived from the login email's local part. */
export function ownerSlugFromEmail(email: string): string {
  const local = email.split('@')[0] ?? ''
  const slug = local.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '')
  return slug.slice(0, 64)
}

/** Icon and color for a pull request's state (M6). */
export function pullStateLook(state: string): { icon: string, class: string } {
  if (state === 'merged') return { icon: 'i-lucide-git-merge', class: 'text-violet-400' }
  return { icon: 'i-lucide-git-pull-request', class: 'text-emerald-500' }
}

export interface PullComment {
  path: string | null
  line: number | null
}

/** Anchored comments keyed `<path>:<line>` — what a diff row looks up (M6). */
export function commentsByAnchor<T extends PullComment>(comments: T[]): Map<string, T[]> {
  const byLine = new Map<string, T[]>()
  for (const comment of comments) {
    if (!comment.path || comment.line === null) continue
    const key = `${comment.path}:${comment.line}`
    byLine.set(key, [...(byLine.get(key) ?? []), comment])
  }
  return byLine
}

/**
 * Comments the conversation list shows: the unanchored ones, plus — once the
 * PR is merged and there is no diff left to hang them on — all of them, so a
 * review record never disappears.
 */
export function conversationComments<T extends PullComment>(comments: T[], hasDiff: boolean): T[] {
  return hasDiff ? comments.filter(c => !c.path || c.line === null) : comments
}
