<script setup lang="ts">
useHead({
  htmlAttrs: { lang: 'en' },
  meta: [
    { name: 'viewport', content: 'width=device-width, initial-scale=1, viewport-fit=cover' },
    { name: 'theme-color', content: '#09090b' },
  ],
})

useSeoMeta({
  title: 'ape-git',
  description: 'DDISA-native git hosting: every access is a revocable grant.',
})
</script>

<template>
  <UApp>
    <NuxtPage />
  </UApp>
</template>
