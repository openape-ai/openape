// story: coder-projects, coder-user-stories (#585).
//
// Repos and links are kept as full URLs, not `owner/repo` shorthand — a project
// may reference code on GitHub, GitLab, Forgejo or a self-hosted forge, and only
// the URL is unambiguous across forges. Validation uses the URL constructor (no
// regex, ReDoS-safe) and accepts only the http/https schemes.

export function isHttpUrl(value: string): boolean {
  let url: URL
  try {
    url = new URL(value)
  }
  catch {
    return false
  }
  return url.protocol === 'http:' || url.protocol === 'https:'
}
