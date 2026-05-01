// PushManager.subscribe() needs the VAPID public key. Public on purpose —
// the key is what the browser embeds in the subscription it sends back.
export default defineEventHandler(() => {
  const key = (useRuntimeConfig().public.vapidPublicKey as string) || ''
  return { vapidPublicKey: key }
})
