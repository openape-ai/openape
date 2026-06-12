// story: coder-invite-members (criterion 8) — #585.
//
// Dismiss one inbox notification. A user may only mark their own notification
// seen — markInboxSeen is keyed by (projectId, the signed-in email), so there
// is nothing to leak or forge.

export default defineEventHandler(async (event) => {
  const email = await requireUser(event)
  const projectId = getRouterParam(event, 'projectId')
  if (!projectId) throw createError({ statusCode: 404, statusMessage: 'Not found' })

  await useMembershipStore().markInboxSeen(projectId, email)
  return { ok: true }
})
