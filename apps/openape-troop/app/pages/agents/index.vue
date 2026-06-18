<script setup lang="ts">
// The flat agent list moved into the Nests view (agents are browsed per nest,
// or per company in the hierarchy). Redirect so there is one default surface:
// the Companies/Nests toggle. Agent chat lives on at /agents/:name.
await navigateTo('/nests', { redirectCode: 301 })
</script>

<template>
  <div />
</template>
