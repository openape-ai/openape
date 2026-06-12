// story: coder-user-stories (criteria 1, 2, 5) — #585.
//
// Create a story. Needs the writeStories grant (admins hold it implicitly, a
// member only if an admin unlocked it). A member without the grant is visibly
// rejected with 403 and nothing is created. Only title + story sentence are
// mandatory; the optional fields are back-fillable.
const TITLE_MAX = 255
const TEXT_MAX = 100_000

export default defineEventHandler(async (event) => {
  const email = await requireUser(event)
  const projectId = getRouterParam(event, 'id')
  if (!projectId) throw createError({ statusCode: 404, statusMessage: 'Project not found' })

  const allowed = await useMembershipStore().hasCapability(projectId, email, 'writeStories')
  if (!allowed) {
    throw createError({ statusCode: 403, statusMessage: 'You may not write stories in this project' })
  }

  const body = (await readBody(event)) as { title?: unknown, storySentence?: unknown } | undefined
  const title = typeof body?.title === 'string' ? body.title.trim() : ''
  const storySentence = typeof body?.storySentence === 'string' ? body.storySentence.trim() : ''
  if (!title || title.length > TITLE_MAX || !storySentence || storySentence.length > TEXT_MAX) {
    throw createError({ statusCode: 400, statusMessage: 'Title and story sentence are required' })
  }

  return useStoryStore().create({ projectId, title, storySentence, authorEmail: email })
})
