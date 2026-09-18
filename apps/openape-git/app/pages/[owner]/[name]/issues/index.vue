<script setup lang="ts">
if (!useRuntimeConfig().public.issuesEnabled) throw createError({ statusCode: 404, statusMessage: 'Page not found' })
</script>

<template>
  <IssueBrowser :owner="String($route.params.owner)" :name="String($route.params.name)" />
</template>
