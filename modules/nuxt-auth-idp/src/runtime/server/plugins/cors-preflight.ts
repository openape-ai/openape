import type { NitroApp } from 'nitropack'

// Paths that should allow CORS (matching the routeRules patterns)
const CORS_PATHS = /^\/(?:\.well-known\/|token\b|userinfo\b|api\/(?:auth|agent|grants|delegations)\/)/

export default (nitroApp: NitroApp) => {
  nitroApp.hooks.hook('request', (event) => {
    if (event.method !== 'OPTIONS') return

    const path = event.path || ''
    if (!CORS_PATHS.test(path)) return

    const res = event.node.res
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
    res.setHeader('Access-Control-Max-Age', '86400')
    res.statusCode = 204
    res.end()
  })
}
