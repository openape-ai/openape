<script setup lang="ts">
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
  titleTemplate: '%s — OpenApe Proxy',
  description: 'Managed HTTP proxy for AI agents. Powered by OpenApe.',
  ogSiteName: 'OpenApe Proxy',
})
</script>

<template>
  <NuxtPage />
</template>
