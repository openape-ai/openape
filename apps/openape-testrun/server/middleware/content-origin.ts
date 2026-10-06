import { createError, defineEventHandler, getRequestURL, setHeaders } from 'h3'
import { useRuntimeConfig } from 'nitropack/runtime'

export default defineEventHandler((event) => {
  const configured = String(useRuntimeConfig().htmlContentOrigin)
  if (!configured || getRequestURL(event).origin !== new URL(configured).origin) return
  setHeaders(event, { 'cache-control': 'no-store', 'referrer-policy': 'no-referrer', 'content-security-policy': 'default-src \'none\'; sandbox' })
  if (!/^\/content\/[\w-]{43}$/u.test(getRequestURL(event).pathname)) throw createError({ statusCode: 404, statusMessage: 'Not found' })
})
