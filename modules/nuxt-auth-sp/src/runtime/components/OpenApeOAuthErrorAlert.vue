<script setup lang="ts">
// Default-styled UAlert that surfaces OAuth-error redirects from
// the IdP per RFC 6749 §4.1.2.1. Drop this on your login landing
// page and the user gets a friendly message instead of mysterious
// URL params. Uses the `useOpenApeOAuthError` composable under the
// hood — for custom styling pull that directly and skip this
// component.

import { useOpenApeOAuthError } from '../composables/useOpenApeOAuthError'

const props = defineProps<{
  /** Override the default friendly copy per error code. Merged on top of the module's defaults. */
  messages?: Record<string, string>
  /** Override the alert title. Default: "Login nicht möglich". */
  title?: string
  /** Tailwind/UAlert color, default 'warning'. */
  color?: 'warning' | 'error' | 'info' | 'neutral'
  /** UAlert variant, default 'subtle'. */
  variant?: 'subtle' | 'soft' | 'solid' | 'outline'
}>()

const { error, dismiss } = useOpenApeOAuthError({ messages: props.messages })
</script>

<template>
  <UAlert
    v-if="error"
    :color="color ?? 'warning'"
    :variant="variant ?? 'subtle'"
    icon="i-lucide-shield-alert"
    :title="title ?? 'Login nicht möglich'"
    :description="error.message"
    :close-button="{ icon: 'i-lucide-x' }"
    @close="dismiss"
  />
</template>
