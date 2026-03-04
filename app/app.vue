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
  titleTemplate: '%s — OpenApe ID',
  description: 'Free DDISA Identity Provider — passwordless authentication with passkeys for domains without their own IdP.',
  ogSiteName: 'OpenApe ID',
})
</script>

<template>
  <NuxtPage />
</template>
