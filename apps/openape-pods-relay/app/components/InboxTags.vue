<script setup lang="ts">
import { t } from '../inbox/i18n'

defineProps<{ tags?: string[] }>()
</script>

<template>
  <span v-if="tags?.length" class="tags"><span class="visually-hidden">{{ t('itemTags') }}: </span><template v-for="tag in tags" :key="tag"><span class="tag">{{ tag }}</span>{{ ' ' }}</template></span>
</template>

<style scoped>
.tags { display: flex; flex-wrap: wrap; gap: 4px; margin: 2px 0; }
.tag { padding: 0 8px; border: 1px solid var(--line); border-radius: 999px; color: var(--muted); font-size: .85em; line-height: 1.6; }
</style>
