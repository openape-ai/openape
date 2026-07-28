import type { NitroApp } from 'nitropack'
import { setResponseHeader } from 'h3'
import { renderErrorPage, wantsHtmlErrorPage } from '../utils/error-page'

export default (nitroApp: NitroApp) => {
  nitroApp.hooks.hook('error', (error: any, { event }) => {
    if (!event)
      return

    const status = error.data?.status || error.statusCode || 500

    // Browser navigations get a human-readable page instead of raw
    // problem+json (#1074). API clients keep RFC 7807 untouched.
    if (wantsHtmlErrorPage(event.node.req.headers)) {
      const retryHeader = event.node.res.getHeader('retry-after')
      const retryAfterSeconds = status === 429 ? Number(retryHeader) : undefined
      setResponseHeader(event, 'Content-Type', 'text/html; charset=utf-8')
      event.node.res.statusCode = status
      event.node.res.end(renderErrorPage(status, { retryAfterSeconds }))
      return
    }

    // If the error was created via createProblemError, its data has RFC 7807 fields
    if (error.data?.type && error.data?.status) {
      setResponseHeader(event, 'Content-Type', 'application/problem+json')
      event.node.res.statusCode = error.data.status
      event.node.res.end(JSON.stringify(error.data))
      return
    }

    // Wrap generic h3 errors in RFC 7807 envelope
    const genericStatus = error.statusCode || 500
    const title = error.statusMessage || 'Internal Server Error'
    const body = {
      type: 'about:blank',
      title,
      status: genericStatus,
      ...(error.message && error.message !== title ? { detail: error.message } : {}),
    }

    setResponseHeader(event, 'Content-Type', 'application/problem+json')
    event.node.res.statusCode = genericStatus
    event.node.res.end(JSON.stringify(body))
  })
}
