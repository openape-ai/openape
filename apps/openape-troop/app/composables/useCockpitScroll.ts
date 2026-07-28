import { ref  } from 'vue'
import type { Ref } from 'vue'
import { isNearBottom } from '../utils/cockpit/scroll'

export function useCockpitScroll(container: Ref<HTMLElement | null>) {
  const stick = ref(true)
  const showPill = ref(false)
  function onScroll() {
    const el = container.value
    if (!el) return
    const near = isNearBottom(el)
    stick.value = near
    showPill.value = !near
  }
  function scrollToBottom(smooth = false) {
    const el = container.value
    if (!el) return
    el.scrollTo({ top: el.scrollHeight, behavior: smooth ? 'smooth' : 'auto' })
    stick.value = true
    showPill.value = false
  }
  function autoStick() {
    if (stick.value) scrollToBottom(false)
  }
  return { stick, showPill, onScroll, scrollToBottom, autoStick }
}
