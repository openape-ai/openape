import ui from '@nuxt/ui/vue-plugin'
import { config, enableAutoUnmount } from '@vue/test-utils'
import { page } from 'vitest/browser'
import { afterEach, beforeEach, vi } from 'vitest'
import { defineComponent, h } from 'vue'
import '../../app/assets/main.css'

enableAutoUnmount(afterEach)
config.global.plugins = [ui]
config.global.components.NuxtLink = defineComponent({
  props: ['to'],
  setup: (props, { slots }) => () => h('a', { href: props.to }, slots.default?.()),
})
beforeEach(async () => {
  await page.viewport(1440, 1000)
  document.documentElement.classList.remove('light')
  document.documentElement.classList.add('dark')
  const runtimeConfig = () => ({ public: { issuesEnabled: true } })
  vi.stubGlobal('useRuntimeConfig', runtimeConfig)
  config.global.mocks.useRuntimeConfig = runtimeConfig
})
afterEach(() => { vi.unstubAllGlobals(); document.body.innerHTML = '' })
