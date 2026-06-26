<script setup lang="ts">
useHead({
  htmlAttrs: { lang: 'en' },
  meta: [
    { name: 'viewport', content: 'width=device-width, initial-scale=1, viewport-fit=cover' },
    { name: 'theme-color', content: '#09090b' },
  ],
})

useSeoMeta({
  title: 'OpenApe Testrun',
  description: 'Upload a test run, share one link that proves it works.',
})
</script>

<template>
  <UApp>
    <NuxtPage />
  </UApp>
</template>
