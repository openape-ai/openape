import { defineEventHandler, setResponseHeader } from 'h3'
import { useStorage } from 'nitropack/runtime'
import { buildChangelogPayload } from '../utils/changelog'

export default defineEventHandler(async (event) => {
  setResponseHeader(event, 'cache-control', 'public, max-age=60')
  const changelog = await useStorage().getItem<string>('assets:server:CHANGELOG.md')
  return buildChangelogPayload(changelog ?? '')
})
