import { getMethod, getRequestURL, getResponseStatus } from 'h3'
import { defineNitroPlugin } from 'nitropack/runtime'

export default defineNitroPlugin((nitro) => {
  console.info(JSON.stringify({ event: 'reports-legacy-observation-start', at: new Date().toISOString() }))
  nitro.hooks.hook('afterResponse', (event) => {
    const method = getMethod(event)
    if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) return
    const path = getRequestURL(event).pathname
    const family = /^\/api\/runs(?:\/|$)/u.test(path)
      ? 'runs'
      : /^\/api\/plans-compat(?:\/|$)/u.test(path) ? 'plans-compat' : undefined
    if (!family) return
    console.info(JSON.stringify({ event: 'reports-legacy-write', at: new Date().toISOString(), method, family, status: getResponseStatus(event) }))
  })
})
