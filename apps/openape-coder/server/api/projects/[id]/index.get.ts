// story: coder-sign-in (criteria 3-5), coder-projects (criterion 3) — #585.
//
// Project detail for members only. `getForMember` returns null for "does not
// exist" and "not a member" alike, so both collapse into the same 404 — a
// non-member can never tell a project apart from a non-existent id.
export default defineEventHandler(async (event) => {
  const email = await requireUser(event)
  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 404, statusMessage: 'Project not found' })

  const project = await useProjectStore().getForMember(id, email)
  if (!project) throw createError({ statusCode: 404, statusMessage: 'Project not found' })
  return project
})
