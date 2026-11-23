// Unknown API paths answer 404 instead of the SPA fallback (ssr: false serves index.html with 200).
export default defineEventHandler(() => {
  throw createError({ statusCode: 404, statusMessage: 'Not Found' })
})
