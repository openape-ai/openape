import { createError, defineEventHandler, setResponseHeader } from 'h3'
import { useStorage } from 'nitropack/runtime'
import { buildChangelogPayload } from '../utils/changelog'

export default defineEventHandler(async (event) => {
  setResponseHeader(event, 'cache-control', 'public, max-age=60')
  setResponseHeader(event, 'content-type', 'application/json; charset=utf-8')
  const changelog = await useStorage().getItem<string>('assets:server:CHANGELOG.md')
  if (!changelog) {
    throw createError({ statusCode: 503, statusMessage: 'Changelog unavailable' })
  }
  return buildChangelogPayload(changelog)
})
