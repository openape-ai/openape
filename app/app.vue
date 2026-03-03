<script setup lang="ts">
import { onMounted } from 'vue'
import { useState } from '#imports'

useHead({
  meta: [
    { name: 'viewport', content: 'width=device-width, initial-scale=1' },
  ],
  link: [
    { rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' },
    { rel: 'icon', type: 'image/x-icon', href: '/favicon.ico' },
  ],
  htmlAttrs: { lang: 'en' },
})

useSeoMeta({
  titleTemplate: '%s — OpenApe ID',
  description: 'Free DDISA Identity Provider — passwordless authentication via magic link for domains without their own IdP.',
  ogSiteName: 'OpenApe ID',
})

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
