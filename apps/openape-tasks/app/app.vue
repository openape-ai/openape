<script setup lang="ts">
useHead({
  htmlAttrs: { lang: 'en' },
  meta: [
    { name: 'viewport', content: 'width=device-width, initial-scale=1, viewport-fit=cover' },
    { name: 'theme-color', content: '#09090b' },
    { name: 'apple-mobile-web-app-capable', content: 'yes' },
    { name: 'apple-mobile-web-app-status-bar-style', content: 'black-translucent' },
    { name: 'apple-mobile-web-app-title', content: 'Tasks' },
  ],
})

useSeoMeta({
  title: 'OpenApe Tasks',
  description: 'Shared task lists for humans and agents.',
})
</script>

<template>
  <UApp>
    <NuxtPage />
  </UApp>
</template>
