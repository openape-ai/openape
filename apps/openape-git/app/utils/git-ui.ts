/** Clone command shown on the repo page — token comes from `apes token`. */
export function cloneCommand(origin: string, owner: string, name: string): string {
  const host = origin.replace(/^https?:\/\//, '')
  return `git clone https://x-access-token:$(apes token)@${host}/${owner}/${name}.git`
}

/** Default owner namespace derived from the login email's local part. */
export function ownerSlugFromEmail(email: string): string {
  const local = email.split('@')[0] ?? ''
  const slug = local.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '')
  return slug.slice(0, 64)
}
