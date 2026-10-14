import { createApp } from 'vue'
import { applyLanguage } from './i18n'
import App from './App.vue'
import DesktopWorkspace from './central/DesktopWorkspace.vue'
import StorageGate from './StorageGate.vue'
import { hostBridgeKey } from './host-bridge'
import { electronBridge } from './adapters/electron'
import './style.css'

declare const __PODS_UI_DEMO__: boolean

async function start(): Promise<void> {
  if (__PODS_UI_DEMO__) {
    const { startDemo } = await import('./demo/start')
    startDemo()
    return
  }
  const bridge = electronBridge()
  applyLanguage(await bridge.language({ type: 'get' }))
  const central = await bridge.central?.({ type: 'status' }) as { enabled: boolean } | undefined
  createApp(StorageGate, { shell: central?.enabled ? DesktopWorkspace : App }).provide(hostBridgeKey, bridge).mount('#app')
}
void start().catch((error: unknown) => {
  console.error('Pods language initialization failed', error)
  document.getElementById('app')!.textContent = 'Sprache konnte nicht geladen werden. Bitte Pods neu starten. / Could not load language. Please restart Pods.'
})
