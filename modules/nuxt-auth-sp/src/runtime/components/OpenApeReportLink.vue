<script setup lang="ts">
import { computed } from 'vue'

const props = withDefaults(defineProps<{ product: string, enabled?: boolean }>(), { enabled: false })
const destination = computed(() => `https://repos.openape.ai/report?product=${encodeURIComponent(props.product)}`)
</script>

<template>
  <footer v-if="enabled" class="openape-report-link">
    <a :href="destination" target="_blank" rel="noopener noreferrer" referrerpolicy="no-referrer">Report a problem</a>
  </footer>
</template>

<style scoped>
.openape-report-link { padding: 0.75rem 1rem; text-align: center; font-size: 0.8125rem; border-top: 1px solid var(--ui-border, #3f3f46); background: var(--ui-bg, #09090b); }
.openape-report-link a { color: var(--ui-primary, #f59e0b); text-decoration: none; }
.openape-report-link a:hover { text-decoration: underline; }
.openape-report-link a:focus-visible { outline: 2px solid currentColor; outline-offset: 4px; }
</style>
