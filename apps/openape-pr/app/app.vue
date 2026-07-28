<script setup lang="ts">
useHead({
  htmlAttrs: { lang: 'en' },
  meta: [
    { name: 'viewport', content: 'width=device-width, initial-scale=1, viewport-fit=cover' },
    { name: 'theme-color', content: '#09090b' },
  ],
})

useSeoMeta({
  title: 'OpenApe PR',
  description: 'Upload a pull request, review it on a beautiful diff, pull the verdict back.',
})
</script>

<template>
  <UApp>
    <NuxtPage />
  </UApp>
</template>
