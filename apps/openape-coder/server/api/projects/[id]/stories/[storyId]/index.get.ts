// story: coder-story-board (criteria 3, 5) — #585.
//
// Read a single story, all its captured parts, scoped to its project. Reading is
// a member base right. A non-member gets the same 404 as a missing project, and
// a story of another project is invisible (the store is project-scoped, so a
// foreign or missing story both collapse into the same 404).
export default defineEventHandler(async (event) => {
  const email = await requireUser(event)
  const projectId = getRouterParam(event, 'id')
  const storyId = getRouterParam(event, 'storyId')
  if (!projectId || !storyId) throw createError({ statusCode: 404, statusMessage: 'Story not found' })

  const membership = await useMembershipStore().getMembership(projectId, email)
  if (!membership) throw createError({ statusCode: 404, statusMessage: 'Project not found' })

  const story = await useStoryStore().getInProject(storyId, projectId)
  if (!story) throw createError({ statusCode: 404, statusMessage: 'Story not found' })
  return story
})
