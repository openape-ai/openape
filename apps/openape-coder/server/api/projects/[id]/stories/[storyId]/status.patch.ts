// story: coder-user-stories (criterion 4) — #585.
//
// Change a story's status. Needs the writeStories grant; the change is recorded
// with author + timestamp inside the store, so a status change is always
// traceable to who changed it when.
import { STORY_STATUSES } from '../../../../../utils/stories'
import type { StoryStatus } from '../../../../../utils/stories'

export default defineEventHandler(async (event) => {
  const email = await requireUser(event)
  const projectId = getRouterParam(event, 'id')
  const storyId = getRouterParam(event, 'storyId')
  if (!projectId || !storyId) throw createError({ statusCode: 404, statusMessage: 'Story not found' })

  const allowed = await useMembershipStore().hasCapability(projectId, email, 'writeStories')
  if (!allowed) {
    throw createError({ statusCode: 403, statusMessage: 'You may not write stories in this project' })
  }

  const body = (await readBody(event)) as { status?: unknown } | undefined
  const status = body?.status
  if (typeof status !== 'string' || !(STORY_STATUSES as readonly string[]).includes(status)) {
    throw createError({ statusCode: 400, statusMessage: 'Unknown status' })
  }

  return useStoryStore().setStatus({ id: storyId, projectId, status: status as StoryStatus, actorEmail: email })
})
