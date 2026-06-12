// story: coder-user-stories (criteria 3, 5) — #585.
//
// Edit a story's parts or optional fields. Needs the writeStories grant; a
// member without it is visibly rejected with 403 and nothing changes. The store
// is project-scoped, so editing only ever touches a story of this project.
// Repos and links are full forge URLs; test references stay free-form
// (test paths, not URLs).
import { isHttpUrl } from '../../../../../utils/urls'

const TITLE_MAX = 255
const TEXT_MAX = 100_000
const LIST_MAX = 200
const ITEM_MAX = 2000

function stringField(value: unknown, max: number): string {
  if (typeof value !== 'string' || value.length > max) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid field value' })
  }
  return value
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > LIST_MAX || value.some(v => typeof v !== 'string' || v.length > ITEM_MAX)) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid list value' })
  }
  return value as string[]
}

function urlList(value: unknown): string[] {
  const list = stringList(value)
  if (list.some(v => !isHttpUrl(v))) {
    throw createError({ statusCode: 400, statusMessage: 'Repos and links must be full http(s) URLs' })
  }
  return list
}

export default defineEventHandler(async (event) => {
  const email = await requireUser(event)
  const projectId = getRouterParam(event, 'id')
  const storyId = getRouterParam(event, 'storyId')
  if (!projectId || !storyId) throw createError({ statusCode: 404, statusMessage: 'Story not found' })

  const allowed = await useMembershipStore().hasCapability(projectId, email, 'writeStories')
  if (!allowed) {
    throw createError({ statusCode: 403, statusMessage: 'You may not write stories in this project' })
  }

  const body = (await readBody(event)) as Record<string, unknown> | undefined
  const patch: Parameters<ReturnType<typeof useStoryStore>['update']>[0]['patch'] = {}
  if (body?.title !== undefined) patch.title = stringField(body.title, TITLE_MAX)
  if (body?.storySentence !== undefined) patch.storySentence = stringField(body.storySentence, TEXT_MAX)
  if (body?.acceptanceCriteria !== undefined) patch.acceptanceCriteria = stringField(body.acceptanceCriteria, TEXT_MAX)
  if (body?.repos !== undefined) patch.repos = urlList(body.repos)
  if (body?.links !== undefined) patch.links = urlList(body.links)
  if (body?.testReferences !== undefined) patch.testReferences = stringList(body.testReferences)

  return useStoryStore().update({ id: storyId, projectId, patch, actorEmail: email })
})
