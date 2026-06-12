// story: coder-invite-members (criteria 3, 4, 5) — #585.
//
// Grant or revoke a member's write capability. Admin-only AND human-only:
// `requireHuman` rejects agent tokens (403), and a non-admin member is rejected
// (403) however many capabilities they hold. The change takes effect at once and
// is audited with actor + timestamp inside the store.
export default defineEventHandler(async (event) => {
  const human = await requireHuman(event)
  const projectId = getRouterParam(event, 'id')
  const target = getRouterParam(event, 'email')
  if (!projectId || !target) throw createError({ statusCode: 404, statusMessage: 'Project not found' })

  const members = useMembershipStore()
  const membership = await members.getMembership(projectId, human.email)
  if (!membership) throw createError({ statusCode: 404, statusMessage: 'Project not found' })
  if (membership.role !== 'admin') {
    throw createError({ statusCode: 403, statusMessage: 'Only admins may change permissions' })
  }

  const body = (await readBody(event)) as { capability?: unknown, granted?: unknown } | undefined
  const capability = body?.capability
  if (capability !== 'editScope' && capability !== 'writeStories') {
    throw createError({ statusCode: 400, statusMessage: 'Unknown capability' })
  }
  if (typeof body?.granted !== 'boolean') {
    throw createError({ statusCode: 400, statusMessage: 'granted must be a boolean' })
  }

  return members.setCapability({
    projectId,
    email: target.toLowerCase(),
    capability,
    granted: body.granted,
    actorEmail: human.email,
  })
})
