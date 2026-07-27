<script setup lang="ts">
useHead({
  htmlAttrs: { lang: 'en' },
  meta: [
    { name: 'viewport', content: 'width=device-width, initial-scale=1, viewport-fit=cover' },
    { name: 'theme-color', content: '#09090b' },
  ],
})

useSeoMeta({
  title: 'OpenApe Monitor',
  description: 'Watch your URLs. Get a mail the moment one goes down.',
})
</script>

<template>
  <UApp>
    <NuxtPage />
  </UApp>
</template>
