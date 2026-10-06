import { ref } from 'vue'

export const toastMessage = ref('')
export const toastLink = ref<{ href: string, label: string } | null>(null)
let timer: ReturnType<typeof setTimeout> | undefined
export function toast(message: string, ms = 4200, link: { href: string, label: string } | null = null) {
  toastLink.value = link
  toastMessage.value = message
  clearTimeout(timer)
  timer = setTimeout(() => { toastMessage.value = '' }, ms)
}
export async function copyText(text: string, done: string) {
  try {
    await navigator.clipboard.writeText(text)
    toast(done)
  }
  catch {
    toast('Copying is blocked here. Select the text instead.')
  }
}
