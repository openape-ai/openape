<script setup lang="ts">
useHead({
  htmlAttrs: { lang: 'en' },
  meta: [
    { name: 'viewport', content: 'width=device-width, initial-scale=1, viewport-fit=cover' },
    { name: 'theme-color', content: '#09090b' },
  ],
})

useSeoMeta({
  title: 'OpenApe Secrets',
  description: 'Hand a secret to a machine without it passing through a chat.',
})
</script>

<template>
  <UApp>
    <NuxtPage />
  </UApp>
</template>
