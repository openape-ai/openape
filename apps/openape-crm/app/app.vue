<script setup lang="ts">
useHead({
  htmlAttrs: { lang: 'de' },
  meta: [
    { name: 'viewport', content: 'width=device-width, initial-scale=1, viewport-fit=cover' },
    { name: 'theme-color', content: '#0c0e13' },
  ],
})

useSeoMeta({
  title: 'OpenApe CRM',
  description: 'Deal-Pipeline, Kontakte und Notizen — für Menschen und Agenten.',
})
</script>

<template>
  <UApp>
    <NuxtLayout>
      <NuxtPage />
    </NuxtLayout>
  </UApp>
</template>
