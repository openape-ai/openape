import { onMounted, onBeforeUnmount } from 'vue'

/**
 * Mirrors the on-screen keyboard height into the CSS var --kb-inset on <html>
 * using the visualViewport API, so the layout can shrink above the keyboard on
 * iOS Safari without any jump.
 */
export function useKeyboardInset() {
  function update() {
    const vv = window.visualViewport
    if (!vv) return
    const inset = Math.max(0, window.innerHeight - vv.height - vv.offsetTop)
    document.documentElement.style.setProperty('--kb-inset', `${inset}px`)
  }

  onMounted(() => {
    const vv = window.visualViewport
    if (!vv) return
    vv.addEventListener('resize', update)
    vv.addEventListener('scroll', update)
    update()
  })

  onBeforeUnmount(() => {
    const vv = window.visualViewport
    if (!vv) return
    vv.removeEventListener('resize', update)
    vv.removeEventListener('scroll', update)
  })
}
