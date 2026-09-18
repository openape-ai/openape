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
    <ClientOnly>
      <UpdateAvailable />
    </ClientOnly>
    <footer v-if="useRuntimeConfig().public.issueReportingEnabled" class="border-t border-zinc-800 p-3 text-center text-sm">
      <a href="https://repos.openape.ai/report?product=idp" target="_blank" rel="noopener noreferrer" referrerpolicy="no-referrer" class="text-amber-500 hover:underline">Report a problem</a>
    </footer>
  </NuxtLayout>
</template>
