import { defineEventHandler, getQuery, setHeader } from 'h3'

export default defineEventHandler((event) => {
  const token = String(getQuery(event).validationToken ?? '')
  if (!token) return { ok: true }
  setHeader(event, 'Content-Type', 'text/plain')
  return token
})
