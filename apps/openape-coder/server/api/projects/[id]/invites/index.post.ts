// story: coder-invite-members (criteria 1, 4, 5, 6, 7) — #585.
//
// Invite a person by email. Admin-only AND human-only: `requireHuman` rejects
// any agent token (act != human) with 403 before anything runs, and a non-admin
// member is rejected with 403 regardless of which write capabilities they hold.
// The store's invite is rate-limited (criterion 7) and acknowledges every
// address identically (criterion 6) — no existence leak.
const EMAIL_MAX = 255

// ReDoS-safe structural check (no backtracking): exactly one '@', a non-empty
// local part, and a domain that contains a dot with non-empty labels.
function looksLikeEmail(value: string): boolean {
  const at = value.indexOf('@')
  if (at <= 0 || at !== value.lastIndexOf('@')) return false
  const domain = value.slice(at + 1)
  if (/\s/.test(value) || !domain.includes('.')) return false
  return domain.split('.').every(label => label.length > 0)
}

export default defineEventHandler(async (event) => {
  const human = await requireHuman(event)
  const projectId = getRouterParam(event, 'id')
  if (!projectId) throw createError({ statusCode: 404, statusMessage: 'Project not found' })

  const members = useMembershipStore()
  const membership = await members.getMembership(projectId, human.email)
  if (!membership) throw createError({ statusCode: 404, statusMessage: 'Project not found' })
  if (membership.role !== 'admin') {
    throw createError({ statusCode: 403, statusMessage: 'Only admins may invite members' })
  }

  const body = (await readBody(event)) as { email?: unknown } | undefined
  const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : ''
  if (!email || email.length > EMAIL_MAX || !looksLikeEmail(email)) {
    throw createError({ statusCode: 400, statusMessage: 'A valid email address is required' })
  }

  // Always the same acknowledgement shape, whatever the address — criterion 6.
  await members.invite({ projectId, email, invitedBy: human.email })
  return { ok: true }
})
