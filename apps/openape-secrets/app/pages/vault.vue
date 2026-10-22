<script setup lang="ts">
import VaultPanel from '../components/VaultPanel.vue'
</script>

<template>
  <OpenApeAuth>
    <ClientOnly><VaultPanel /></ClientOnly>
  </OpenApeAuth>
</template>
