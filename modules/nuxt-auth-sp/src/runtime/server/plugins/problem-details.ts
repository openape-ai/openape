import type { NitroApp } from 'nitropack'
import { setResponseHeader } from 'h3'

export default (nitroApp: NitroApp) => {
  nitroApp.hooks.hook('error', (error: any, { event }) => {
    if (!event)
      return

    // If the error was created via createProblemError, its data has RFC 7807 fields
    if (error.data?.type && error.data?.status) {
      setResponseHeader(event, 'Content-Type', 'application/problem+json')
      event.node.res.statusCode = error.data.status
      event.node.res.end(JSON.stringify(error.data))
      return
    }

    // Wrap generic h3 errors in RFC 7807 envelope
    const status = error.statusCode || 500
    const title = error.statusMessage || 'Internal Server Error'
    const body = {
      type: 'about:blank',
      title,
      status,
      ...(error.message && error.message !== title ? { detail: error.message } : {}),
    }

    setResponseHeader(event, 'Content-Type', 'application/problem+json')
    event.node.res.statusCode = status
    event.node.res.end(JSON.stringify(body))
  })
}
