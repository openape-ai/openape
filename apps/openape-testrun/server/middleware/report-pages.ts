import { defineEventHandler, getRequestURL, sendRedirect } from 'h3'
import { privateReportHeaders } from '../utils/report-auth'

// Reports has no browser editor any more; old edit links open the report instead.
export function editRedirect(path: string, search: string) {
  const id = /^\/d\/([\w-]{1,64})\/edit\/?$/u.exec(path)?.[1]
  if (!id) return null
  const version = new URLSearchParams(search).get('v')
  return version && /^[1-9]\d{0,8}$/u.test(version) ? `/d/${id}?v=${version}` : `/d/${id}`
}

export default defineEventHandler((event) => {
  const { pathname, search } = getRequestURL(event)
  const target = editRedirect(pathname, search)
  if (target) return sendRedirect(event, target, 301)
  if (pathname.startsWith('/r/') || pathname === '/reports' || pathname === '/reports/removed') privateReportHeaders(event)
})
