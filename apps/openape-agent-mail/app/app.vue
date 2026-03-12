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
  titleTemplate: '%s — OpenApe Agent Mail',
  description: 'Ephemeral email addresses for AI agents. Manage domains and mailboxes with OpenApe authentication.',
  ogSiteName: 'OpenApe Agent Mail',
})
</script>

<template>
  <NuxtPage />
</template>
