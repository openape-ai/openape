// story: coder-projects (criteria 3, 5) — #585.
//
// Update a project's vision and/or affected repos. Membership is required (a
// non-member gets the same 404 as a missing project — no existence leak), and
// editing the scope needs the editScope grant: admins always hold it, a member
// only if an admin unlocked it. A member without the grant is visibly rejected
// with 403 and nothing changes. Each repo is a full forge URL (criterion 6),
// validated http(s) so the list stays forge-agnostic and clickable.
import { isHttpUrl } from '../../../utils/urls'

const VISION_MAX = 100_000
const REPOS_MAX = 200
const REPO_URL_MAX = 1000

export default defineEventHandler(async (event) => {
  const email = await requireUser(event)
  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 404, statusMessage: 'Project not found' })

  const store = useProjectStore()
  const membership = await store.getMembership(id, email)
  if (!membership) throw createError({ statusCode: 404, statusMessage: 'Project not found' })
  if (!membership.canEditScope) {
    throw createError({ statusCode: 403, statusMessage: 'You may not edit this project\'s vision or repos' })
  }

  const body = (await readBody(event)) as { visionMd?: unknown, repos?: unknown } | undefined
  const patch: { visionMd?: string, repos?: string[] } = {}

  if (body?.visionMd !== undefined) {
    if (typeof body.visionMd !== 'string' || body.visionMd.length > VISION_MAX) {
      throw createError({ statusCode: 400, statusMessage: 'Invalid vision text' })
    }
    patch.visionMd = body.visionMd
  }

  if (body?.repos !== undefined) {
    if (
      !Array.isArray(body.repos)
      || body.repos.length > REPOS_MAX
      || body.repos.some(r => typeof r !== 'string' || r.length > REPO_URL_MAX || !isHttpUrl(r))
    ) {
      throw createError({ statusCode: 400, statusMessage: 'Each repo must be a full http(s) URL' })
    }
    patch.repos = body.repos as string[]
  }

  return store.updateScope(id, patch)
})
