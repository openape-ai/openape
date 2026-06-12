// story: coder-invite-members, coder-projects (#585).
//
// The member list of a project — who belongs, their role and granted write
// capabilities. Reading is a member base right (the project detail page shows
// it to everyone in the project). A non-member gets the same 404 as a missing
// project, so membership never leaks a project's existence or its people.
export default defineEventHandler(async (event) => {
  const email = await requireUser(event)
  const projectId = getRouterParam(event, 'id')
  if (!projectId) throw createError({ statusCode: 404, statusMessage: 'Project not found' })

  const members = useMembershipStore()
  const own = await members.getMembership(projectId, email)
  if (!own) throw createError({ statusCode: 404, statusMessage: 'Project not found' })

  return members.list(projectId)
})
