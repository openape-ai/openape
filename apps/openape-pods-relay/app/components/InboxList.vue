<script setup lang="ts">
import type { InboxItem, Receipt } from '../inbox/client'
import { formatTime, t } from '../inbox/i18n'

defineProps<{ items: InboxItem[], empty: string, receipts?: Record<string, Receipt> }>()
const excerpt = (body: string) => body.length > 160 ? `${body.slice(0, 160).trimEnd()} …` : body
</script>

<template>
  <p v-if="!items.length" class="inbox-muted">
    {{ empty }}
  </p>
  <ul v-else class="list">
    <li v-for="item in items" :key="item.id">
      <NuxtLink class="inbox-card" :class="{ unread: item.kind === 'message' && !item.read }" :to="`/inbox/item/${item.id}`">
        <span v-if="item.kind === 'message' && !item.read" class="visually-hidden">{{ t('unread') }}: </span>
        <strong>{{ item.title }}</strong>
        <span v-if="item.body" class="excerpt">{{ excerpt(item.body) }}</span>
        <small>
          <template v-if="item.pod?.name">{{ t('itemPod', { name: item.pod.name }) }} · </template>{{ formatTime(item.created) }}
          <template v-if="item.decision?.options.length && item.state === 'open'"> · {{ item.decision.options.map(option => option.title).join(' / ') }}</template>
          <template v-if="receipts?.[item.id]"> · {{ receipts[item.id]!.title }}</template>
        </small>
      </NuxtLink>
    </li>
  </ul>
</template>

<style scoped>
.list { list-style: none; margin: 0; padding: 0; }
.excerpt { display: -webkit-box; -webkit-line-clamp: 2; line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; margin: 2px 0; }
.unread strong::before { content: '●'; color: var(--accent); margin-right: 6px; }
</style>
