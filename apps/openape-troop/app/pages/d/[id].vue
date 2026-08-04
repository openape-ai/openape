<script setup lang="ts">
// Cards used to live at /d/<id>. Those links are out in the world — in push
// notifications, in chat, on phones — so the old path keeps working forever
// and simply forwards to the call.
const route = useRoute()
await navigateTo(`/c/${route.params.id}`, { redirectCode: 301 })
</script>

<template>
  <div />
</template>
