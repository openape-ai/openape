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
  <div v-if="push.supported.value" class="w-full px-4 py-3 border border-gray-800 rounded-lg flex items-center gap-3 bg-gray-900/40">
    <UIcon name="i-lucide-bell" class="size-5 text-gray-400" />
    <div class="flex-1 text-sm text-left">
      <p class="font-medium text-white">
        Approval-Benachrichtigungen
      </p>
      <p class="text-gray-500 text-xs">
        {{ push.subscribed.value
          ? 'Aktiv — du wirst gepingt, wenn ein Grant auf deine Approval wartet.'
          : 'Push-Benachrichtigung wenn ein Grant deine Approval braucht.' }}
      </p>
    </div>
    <UButton
      :color="push.subscribed.value ? 'neutral' : 'primary'"
      :variant="push.subscribed.value ? 'soft' : 'solid'"
      size="sm"
      :loading="busy"
      @click="toggle"
    >
      {{ push.subscribed.value ? 'Aus' : 'Ein' }}
    </UButton>
  </div>
  <p v-if="error" class="px-4 pt-1 text-xs text-red-400">
    {{ error }}
  </p>
</template>
