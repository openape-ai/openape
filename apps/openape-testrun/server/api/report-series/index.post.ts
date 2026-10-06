import { defineEventHandler, setResponseStatus } from 'h3'
import { useDatabaseClient } from '../../database/drizzle'
import { reportOwner } from '../../utils/report-auth'
import { limitReportRequests, readReportBody } from '../../utils/report-request'
import { createReportSeries } from '../../utils/report-store'
import { createProblemError } from '../../utils/problem'

export default defineEventHandler(async (event) => {
  limitReportRequests(event)
  const principal = await reportOwner(event, 'reports:manage')
  const { data } = await readReportBody(event)
  const body = data as { name?: unknown }
  if (!body || Object.keys(body).some(key => key !== 'name') || typeof body.name !== 'string' || !body.name.trim() || body.name.length > 200) throw createProblemError({ status: 400, title: 'A series name is required' })
  const series = await createReportSeries(useDatabaseClient(), principal.subject, body.name.trim())
  setResponseStatus(event, 201)
  return series
})
