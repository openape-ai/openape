<script setup lang="ts">
// Legacy route — the company view moved to the Companies list (/companies)
// + per-company detail (/companies/:id). Keep this path working by redirecting.
await navigateTo('/companies', { redirectCode: 301 })
</script>

<template>
  <div />
</template>
