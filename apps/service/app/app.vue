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
  titleTemplate: '%s — OpenApe Cloud',
  description: 'Passkey authentication, delegated authorization, and agent management — ready in minutes. Built on the open DDISA protocol.',
  ogSiteName: 'OpenApe Cloud',
})
</script>

<template>
  <NuxtLayout>
    <NuxtPage />
  </NuxtLayout>
</template>
