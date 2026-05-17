// The browser needs the VAPID public key (server identity) when calling
// PushManager.subscribe(). Public so any logged-in user can fetch it.
export default defineEventHandler(() => {
  const key = (useRuntimeConfig().public.vapidPublicKey as string) || ''
  return { vapidPublicKey: key }
})
