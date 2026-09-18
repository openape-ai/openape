<script setup lang="ts">
if (!useRuntimeConfig().public.issuesEnabled) throw createError({ statusCode: 404, statusMessage: 'Page not found' })
</script>

<template>
  <IssueLegacy :source-url="String($route.query.url || '')" :fragment="$route.hash" />
</template>
