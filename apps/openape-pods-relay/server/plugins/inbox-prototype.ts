import { dispatchDuePushes } from '../utils/inbox'

export default defineNitroPlugin((nitro) => {
  const timer = setInterval(() => { dispatchDuePushes().catch(error => console.error('inbox push dispatch failed', error)) }, 5000)
  timer.unref()
  nitro.hooks.hook('close', () => { clearInterval(timer) })
})
