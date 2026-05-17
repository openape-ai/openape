import { onMounted, ref } from 'vue'

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

const DISMISSAL_KEY = 'openape-chat:install-banner-dismissed-at'
const DISMISSAL_TTL_MS = 30 * 24 * 60 * 60 * 1000 // 30 days

export function usePwaInstall() {
  const isInstalled = ref(false)
  const isMobile = ref(false)
  const isIOS = ref(false)
  const promptEvent = ref<BeforeInstallPromptEvent | null>(null)
  const dismissed = ref(false)

  function checkDismissed(): boolean {
    if (typeof localStorage === 'undefined') return false
    const at = localStorage.getItem(DISMISSAL_KEY)
    if (!at) return false
    const ms = Number.parseInt(at, 10)
    if (!Number.isFinite(ms)) return false
    return Date.now() - ms < DISMISSAL_TTL_MS
  }

  function markDismissed() {
    if (typeof localStorage === 'undefined') return
    localStorage.setItem(DISMISSAL_KEY, String(Date.now()))
    dismissed.value = true
  }

  async function install() {
    if (!promptEvent.value) return false
    await promptEvent.value.prompt()
    const choice = await promptEvent.value.userChoice
    promptEvent.value = null
    if (choice.outcome === 'accepted') {
      isInstalled.value = true
    }
    return choice.outcome === 'accepted'
  }

  onMounted(() => {
    if (typeof window === 'undefined') return

    isInstalled.value = window.matchMedia('(display-mode: standalone)').matches
      || (window.navigator as { standalone?: boolean }).standalone === true

    isMobile.value = window.matchMedia('(max-width: 768px)').matches
      || /android|iphone|ipad|ipod/i.test(navigator.userAgent)
    isIOS.value = /iphone|ipad|ipod/i.test(navigator.userAgent)
      && !(window.navigator as { standalone?: boolean }).standalone

    dismissed.value = checkDismissed()

    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault()
      promptEvent.value = e as BeforeInstallPromptEvent
    })
    window.addEventListener('appinstalled', () => {
      isInstalled.value = true
      promptEvent.value = null
    })
  })

  return { isInstalled, isMobile, isIOS, promptEvent, dismissed, install, markDismissed }
}
