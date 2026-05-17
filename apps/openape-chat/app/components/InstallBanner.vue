<script setup lang="ts">
const { isInstalled, isMobile, isIOS, promptEvent, dismissed, install, markDismissed } = usePwaInstall()
const showIosHint = ref(false)

const visible = computed(() => {
  if (isInstalled.value) return false
  if (dismissed.value) return false
  if (!isMobile.value) return false
  // Show banner if either we have a captured Android prompt OR we're on iOS
  // (where there's no programmatic install — only the Add-to-Home-Screen
  // gesture, so the banner becomes a one-time how-to).
  return promptEvent.value !== null || isIOS.value
})
</script>

<template>
  <div
    v-if="visible"
    class="fixed bottom-0 inset-x-0 z-40 p-3 pb-[env(safe-area-inset-bottom)] bg-zinc-900/95 backdrop-blur border-t border-zinc-800 md:hidden"
  >
    <div class="flex items-center gap-3 max-w-md mx-auto">
      <div class="flex-1 text-sm">
        <p class="font-medium">
          Install OpenApe Chat
        </p>
        <p class="text-zinc-400">
          Get faster access and notifications when something happens.
        </p>
      </div>
      <UButton
        v-if="!isIOS"
        color="primary"
        size="sm"
        @click="() => { install() }"
      >
        Install
      </UButton>
      <UButton
        v-else
        color="primary"
        size="sm"
        variant="soft"
        @click="showIosHint = true"
      >
        How
      </UButton>
      <UButton
        color="neutral"
        size="sm"
        variant="ghost"
        icon="i-lucide-x"
        aria-label="Dismiss install hint"
        @click="markDismissed"
      />
    </div>

    <UModal v-model:open="showIosHint">
      <template #content>
        <div class="p-6 space-y-4">
          <h2 class="text-lg font-semibold">
            Install on iOS
          </h2>
          <ol class="list-decimal pl-5 space-y-2 text-sm">
            <li>Tap the <strong>Share</strong> button at the bottom of Safari.</li>
            <li>Scroll and tap <strong>Add to Home Screen</strong>.</li>
            <li>Tap <strong>Add</strong> in the top-right corner.</li>
          </ol>
          <UButton block color="primary" @click="showIosHint = false">
            Got it
          </UButton>
        </div>
      </template>
    </UModal>
  </div>
</template>
