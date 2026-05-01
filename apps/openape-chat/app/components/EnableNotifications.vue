<script setup lang="ts">
const push = usePushSubscription()
const busy = ref(false)
const error = ref<string | null>(null)

async function toggle() {
  busy.value = true
  error.value = null
  try {
    if (push.subscribed.value) {
      await push.disable()
    }
    else {
      const ok = await push.enable()
      if (!ok) error.value = 'Notifications not enabled. Check browser permissions.'
    }
  }
  finally {
    busy.value = false
  }
}
</script>

<template>
  <div v-if="push.supported.value" class="px-4 py-3 border-t border-zinc-800 flex items-center gap-3">
    <UIcon name="i-lucide-bell" class="size-4 text-zinc-500" />
    <div class="flex-1 text-sm">
      <p class="font-medium">
        Notifications
      </p>
      <p class="text-zinc-500 text-xs">
        {{ push.subscribed.value ? 'Enabled — you will be pinged on new messages.' : 'Get pinged when someone messages you.' }}
      </p>
    </div>
    <UButton
      :color="push.subscribed.value ? 'neutral' : 'primary'"
      :variant="push.subscribed.value ? 'soft' : 'solid'"
      size="sm"
      :loading="busy"
      @click="toggle"
    >
      {{ push.subscribed.value ? 'Disable' : 'Enable' }}
    </UButton>
  </div>
  <p v-if="error" class="px-4 pb-2 text-xs text-red-400">
    {{ error }}
  </p>
</template>
