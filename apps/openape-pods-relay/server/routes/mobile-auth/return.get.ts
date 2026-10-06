export default defineEventHandler((event) => {
  setHeader(event, 'cache-control', 'no-store')
  setHeader(event, 'referrer-policy', 'no-referrer')
  return 'Return to OpenApe Pods to finish signing in.'
})
