/**
 * Clone command shown on the repo page. The DDISA token lives in the file
 * `apes login` writes — there is no `apes token` subcommand (M1 lesson).
 */
export function cloneCommand(origin: string, owner: string, name: string): string {
  const host = origin.replace(/^https?:\/\//, '')
  return `git clone https://x-access-token:$(jq -r .access_token ~/.config/apes/auth.json)@${host}/${owner}/${name}.git`
}

/** Default owner namespace derived from the login email's local part. */
export function ownerSlugFromEmail(email: string): string {
  const local = email.split('@')[0] ?? ''
  const slug = local.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '')
  return slug.slice(0, 64)
}
