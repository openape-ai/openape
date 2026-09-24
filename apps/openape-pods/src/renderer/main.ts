import { createApp } from 'vue'
import { applyLanguage } from './i18n'
import App from './App.vue'
import DesktopWorkspace from './central/DesktopWorkspace.vue'
import './style.css'

async function start(): Promise<void> {
  applyLanguage(await window.pods.language({ type: 'get' }))
  const central = await window.pods.central?.({ type: 'status' }) as { enabled: boolean } | undefined
  createApp(central?.enabled ? DesktopWorkspace : App).mount('#app')
}
void start().catch((error: unknown) => {
  console.error('Pods language initialization failed', error)
  document.getElementById('app')!.textContent = 'Sprache konnte nicht geladen werden. Bitte Pods neu starten. / Could not load language. Please restart Pods.'
})
