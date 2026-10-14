import { createApp } from 'vue'
import DemoApp from './DemoApp.vue'

export function startDemo() {
  createApp(DemoApp).mount('#app')
}
