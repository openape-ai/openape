// story: coder-story-board (criteria 1, 2, 4, 5) — #585.
//
// The story board: every story of the project with title + status. Reading is a
// member base right — any member may read without a further grant. A non-member
// gets the same 404 as a missing project (no existence leak), and the board
// never shows stories of another project (the store is project-scoped).
export default defineEventHandler(async (event) => {
  const email = await requireUser(event)
  const projectId = getRouterParam(event, 'id')
  if (!projectId) throw createError({ statusCode: 404, statusMessage: 'Project not found' })

  const membership = await useMembershipStore().getMembership(projectId, email)
  if (!membership) throw createError({ statusCode: 404, statusMessage: 'Project not found' })

  return useStoryStore().listForProject(projectId)
})
