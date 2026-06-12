// story: coder-projects (criterion 1) — #585.
//
// Any signed-in user may create a project and becomes its admin. Vision and
// repos are optional and back-fillable (criterion 2), so only a name is required.
const NAME_MAX = 255

export default defineEventHandler(async (event) => {
  const email = await requireUser(event)
  const body = (await readBody(event)) as { name?: unknown } | undefined
  const name = typeof body?.name === 'string' ? body.name.trim() : ''
  if (!name || name.length > NAME_MAX) {
    throw createError({ statusCode: 400, statusMessage: 'A project name is required' })
  }
  return useProjectStore().create({ name, creatorEmail: email })
})
