import { defineEventHandler, getQuery } from 'h3'
import { useDatabaseClient } from '../database/drizzle'
import { htmlProblem } from '../utils/html-api'
import { discoverLibrary } from '../utils/library'
import { reportOwner } from '../utils/report-auth'

export default defineEventHandler(async (event) => {
  const identity = await reportOwner(event)
  const query = getQuery(event)
  try {
    return await discoverLibrary(useDatabaseClient(), identity, { search: query.q, category: query.category, tags: query.tag, team: query.team, access: query.access, field: query.field, value: query.value, sort: query.sort, limit: query.limit, cursor: query.cursor })
  }
  catch (error) { htmlProblem(error) }
})
