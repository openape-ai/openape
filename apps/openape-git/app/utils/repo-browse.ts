// Pure helpers for the code-browsing pages.

export interface Crumb {
  name: string
  path: string
}

/** `src/app` → [{name:'src',path:'src'},{name:'app',path:'src/app'}] */
export function breadcrumbs(path: string): Crumb[] {
  if (!path) return []
  const crumbs: Crumb[] = []
  let acc = ''
  for (const seg of path.split('/')) {
    acc = acc ? `${acc}/${seg}` : seg
    crumbs.push({ name: seg, path: acc })
  }
  return crumbs
}

export function parentPath(path: string): string {
  const idx = path.lastIndexOf('/')
  return idx === -1 ? '' : path.slice(0, idx)
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function shortSha(sha: string): string {
  return sha.slice(0, 7)
}

/** Unix seconds → "2026-08-28" (UTC, stable across client locales). */
export function formatDate(unixSeconds: number): string {
  if (!Number.isFinite(unixSeconds) || unixSeconds <= 0) return ''
  return new Date(unixSeconds * 1000).toISOString().slice(0, 10)
}
