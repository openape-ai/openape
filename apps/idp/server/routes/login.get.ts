export default defineEventHandler((event) => {
  const query = getQuery(event)
  return { loginRequired: true, returnTo: query.returnTo || '/' }
})
