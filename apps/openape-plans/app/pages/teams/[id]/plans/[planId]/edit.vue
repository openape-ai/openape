<script setup lang="ts">
const route = useRoute()
onMounted(() => window.location.replace(route.fullPath))
</script>

<template>
  <p>Opening plan in Reports…</p>
</template>
