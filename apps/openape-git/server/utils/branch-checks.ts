export interface RequiredCheck {
  context: string
  state: string
  sha: string
  targetUrl?: string | null
}

/** Fail closed; checks from another commit never satisfy a required context. */
export function checkBlockers(contexts: string[], checks: RequiredCheck[], sha: string): string[] {
  return contexts.flatMap((context) => {
    const check = checks.find(c => c.context === context && c.sha === sha)
    return check?.state === 'success' ? [] : [`${context}: ${check?.state ?? 'missing'}`]
  })
}

export function reviewedHeadsMatch(expectedSource: unknown, expectedTarget: unknown, source: string, target: string): boolean {
  return expectedSource === source && expectedTarget === target
}

export function forgejoApiBase(mirrorUrl: string): string {
  const url = new URL(mirrorUrl)
  const parts = url.pathname.replace(/\.git\/?$/, '').split('/').filter(Boolean)
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || parts.length !== 2)
    throw new Error('CI provider requires an HTTPS Forgejo repository mirror URL')
  return `${url.origin}/api/v1/repos/${parts.map(encodeURIComponent).join('/')}`
}

export function normalizeForgejoChecks(data: { sha?: string, statuses?: { id: number, context: string, status: string, target_url?: string, description?: string, created_at?: string }[] }, requestedSha: string, origin: string) {
  if (data.sha !== requestedSha || !Array.isArray(data.statuses)) throw new Error('CI provider returned results for an unexpected commit')
  const seen = new Set<string>()
  return [...data.statuses].sort((a, b) => b.id - a.id).flatMap((s) => {
    if (!s.context || seen.has(s.context)) return []
    seen.add(s.context)
    const state = s.status === 'success' ? 'success' : ['failure', 'error', 'cancelled'].includes(s.status) ? 'failure' : 'pending'
    let targetUrl: string | null = null
    if (s.target_url) {
      const url = new URL(s.target_url, origin)
      if (url.origin === origin && url.protocol === 'https:') targetUrl = url.href
    }
    return [{ id: `forgejo:${s.id}`, sha: requestedSha, context: s.context, state, targetUrl, description: s.description ?? '', createdAt: Math.floor(Date.parse(s.created_at ?? '') / 1000) || 0, provider: 'forgejo' as const, log: null }]
  })
}
