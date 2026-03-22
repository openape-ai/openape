<script setup lang="ts">
useHead({
  meta: [
    { name: 'viewport', content: 'width=device-width, initial-scale=1' },
  ],
  link: [
    { rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' },
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
  <NuxtLayout>
    <NuxtPage />
  </NuxtLayout>
</template>
