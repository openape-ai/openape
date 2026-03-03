<script setup lang="ts">
import { onMounted } from 'vue'
import { useState } from '#imports'

// Load CSRF token from session into state for use in forms
const csrfToken = useState<string>('csrfToken', () => '')

onMounted(async () => {
  try {
    const data = await $fetch<{ csrfToken: string }>('/api/csrf')
    csrfToken.value = data.csrfToken
  }
  catch {
    // No CSRF token available (no pending authorize)
  }
})
</script>

<template>
  <NuxtPage />
</template>
