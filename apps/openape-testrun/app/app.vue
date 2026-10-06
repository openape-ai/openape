<script setup lang="ts">
useHead({
  htmlAttrs: { lang: 'en' },
  meta: [
    { name: 'viewport', content: 'width=device-width, initial-scale=1, viewport-fit=cover' },
    { name: 'theme-color', content: '#09090b' },
  ],
})

useSeoMeta({
  title: 'OpenApe Reports',
  description: 'A home for clear findings, useful context and results worth keeping.',
})
</script>

<template>
  <UApp>
    <NuxtPage />
    <OpenApeReportLink product="testrun" :enabled="useRuntimeConfig().public.issueReportingEnabled" />
  </UApp>
</template>
