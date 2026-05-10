<script setup lang="ts">
import { useRegisterSW } from 'virtual:pwa-register/vue'

// `needRefresh` flips true when a new SW has installed but is waiting; the
// user has to confirm before we activate it (via updateServiceWorker(true))
// because hot-swapping mid-session is jarring (open dialogs, scroll positions,
// in-flight WS reconnects all evaporate).
const { needRefresh, updateServiceWorker } = useRegisterSW({
  immediate: true,
  onRegisteredSW(_url: string, registration: ServiceWorkerRegistration | undefined) {
    if (!registration) return
    // Probe for updates whenever the user comes back to the tab. Periodic
    // sync is also configured in nuxt.config.ts (hourly), but that fires
    // only while the tab is active anyway — visibilitychange covers the
    // case where the user switches tabs/apps and comes back.
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
          A newer version of OpenApe Chat is ready.
        </p>
      </div>
      <UButton size="sm" color="primary" @click="reload">
        Reload
      </UButton>
    </div>
  </Transition>
</template>
