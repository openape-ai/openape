<script setup>
import { useOpenApeOAuthError } from '../composables/useOpenApeOAuthError'

const props = defineProps({
  messages: { type: Object, required: false },
  title: { type: String, required: false },
  color: { type: String, required: false },
  variant: { type: String, required: false },
})
const { error, dismiss } = useOpenApeOAuthError({ messages: props.messages })
</script>

<template>
  <UAlert
    v-if="error"
    :color="color ?? 'warning'"
    :variant="variant ?? 'subtle'"
    icon="i-lucide-shield-alert"
    :title="title ?? 'Login nicht m\xF6glich'"
    :description="error.message"
    :close-button="{ icon: 'i-lucide-x' }"
    @close="dismiss"
  />
</template>
