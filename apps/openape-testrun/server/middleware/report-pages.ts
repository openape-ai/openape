import { defineEventHandler, getRequestURL } from 'h3'
import { privateReportHeaders } from '../utils/report-auth'

export default defineEventHandler((event) => {
  const path = getRequestURL(event).pathname
  if (path.startsWith('/r/') || path === '/reports' || path === '/reports/removed') privateReportHeaders(event)
})
