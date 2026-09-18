<script setup lang="ts">
if (!useRuntimeConfig().public.issuesEnabled) throw createError({ statusCode: 404, statusMessage: 'Page not found' })
</script>

<template>
  <IssueReport />
</template>
