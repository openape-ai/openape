<script setup lang="ts">
definePageMeta({ layout: false })
useHead({
  title: 'Cockpit',
  meta: [
    { name: 'viewport', content: 'width=device-width, initial-scale=1, minimum-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover' },
    { name: 'apple-mobile-web-app-capable', content: 'yes' },
    { name: 'mobile-web-app-capable', content: 'yes' },
    { name: 'apple-mobile-web-app-status-bar-style', content: 'black-translucent' },
    { name: 'apple-mobile-web-app-title', content: 'Cockpit' },
    { name: 'theme-color', content: '#0b0b0f' },
  ],
  link: [
    { rel: 'manifest', href: '/cockpit.webmanifest' },
    { rel: 'apple-touch-icon', href: '/cockpit-icon-180.png' },
  ],
})
</script>

<template>
  <CockpitChat />
</template>

<style>
@import '~/assets/css/cockpit.css';
</style>
