<script setup lang="ts">
import { useRegisterSW } from 'virtual:pwa-register/vue'

// vite-pwa's `registerType: 'autoUpdate'` default behaviour (without
// onNeedRefresh override) is to skipWaiting + window.location.reload()
// the moment a new SW takes control. That reload kills any in-flight
// WebAuthn promise — Patrick saw "click passkey → nothing happens"
// because a hourly periodic-update fired while macOS was showing the
// TouchID prompt, reloading /login under him. The next click worked
// because the new SW was already active.
//
// Mirror chat's pattern: intercept onNeedRefresh, show a banner, let
// the user confirm the reload at a safe moment. Mounted globally from
// app.vue so it's available on every IdP page.
const { needRefresh, updateServiceWorker } = useRegisterSW({
  immediate: true,
  onRegisteredSW(_url: string, registration: ServiceWorkerRegistration | undefined) {
    if (!registration) return
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        registration.update().catch(() => {})
      }
    })
  },
})

async function reload() {
  await updateServiceWorker(true)
}
</script>

<template>
  <Transition
    enter-active-class="transition duration-300 ease-out"
    enter-from-class="opacity-0 translate-y-4"
    enter-to-class="opacity-100 translate-y-0"
    leave-active-class="transition duration-200 ease-in"
    leave-to-class="opacity-0 translate-y-4"
  >
    <div
      v-if="needRefresh"
      class="fixed top-[calc(env(safe-area-inset-top)+0.75rem)] inset-x-3 md:top-4 md:left-auto md:right-4 md:w-80 z-50 rounded-lg shadow-lg bg-zinc-900 border border-zinc-700 p-3 flex items-center gap-3"
    >
      <UIcon name="i-lucide-download" class="text-primary-400 size-5 shrink-0" />
      <div class="flex-1 text-sm">
        <p class="font-medium">
          Update available
        </p>
        <p class="text-zinc-400">
          A newer version of OpenApe ID is ready.
        </p>
      </div>
      <UButton size="sm" color="primary" @click="reload">
        Reload
      </UButton>
    </div>
  </Transition>
</template>
