<script setup lang="ts">
defineProps<{ html: string }>()
</script>

<template>
  <!-- eslint-disable-next-line vue/no-v-html -- issue HTML is sanitized by the server renderer -->
  <div class="markdown-body text-sm" v-html="html || '<p>No description provided.</p>'" />
</template>
