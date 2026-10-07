<script setup lang="ts">
import { blocking } from '../inbox/client'
import type { InboxItem, Receipt } from '../inbox/client'
import { formatTime, t } from '../inbox/i18n'
import { receiptText } from '../inbox/receipt'

const props = defineProps<{ items: InboxItem[], empty: string, receipts?: Record<string, Receipt>, online?: boolean }>()
const emit = defineEmits<{ decide: [item: InboxItem, option: string] }>()
const excerpt = (body: string) => body.length > 160 ? `${body.slice(0, 160).trimEnd()} …` : body
// Pods decisions can be answered on the card; an option that needs evidence or a value opens the detail with it preselected.
const quick = (item: InboxItem) => item.kind === 'decision' && item.state === 'open' && item.decision?.authority === 'pods' && !blocking(props.receipts?.[item.id], item) ? item.decision.options : []
</script>

<template>
  <p v-if="!items.length" class="inbox-muted">
    {{ empty }}
  </p>
  <ul v-else class="list">
    <li v-for="item in items" :key="item.id" class="inbox-card" :class="{ unread: item.kind === 'message' && !item.read }">
      <NuxtLink class="card-link" :to="`/inbox/item/${item.id}`">
        <span v-if="item.kind === 'message' && !item.read" class="visually-hidden">{{ t('unread') }}: </span>
        <strong>{{ item.title }}</strong>
        <span v-if="item.body" class="excerpt">{{ excerpt(item.body) }}</span>
        <small>
          <template v-if="item.pod?.name">{{ t('itemPod', { name: item.pod.name }) }} · </template>{{ formatTime(item.created) }}
          <template v-if="receipts?.[item.id]?.state === 'applied' && item.state !== 'open'"> · {{ t('receiptAppliedShort', { option: receipts[item.id]!.title }) }}</template>
        </small>
      </NuxtLink>
      <p v-if="item.state === 'open' && receipts?.[item.id]" class="status" role="status">
        {{ receiptText(receipts[item.id]) }}
      </p>
      <div v-if="quick(item).length" class="quick" role="group" :aria-label="t('decideOn', { title: item.title })">
        <template v-for="option in quick(item)" :key="option.key">
          <NuxtLink v-if="option.input" class="quick-link" :to="{ path: `/inbox/item/${item.id}`, query: { option: option.key } }">
            {{ option.title }} …
          </NuxtLink>
          <button v-else type="button" class="secondary" :disabled="!online" @click="emit('decide', item, option.key)">
            {{ option.title }}
          </button>
        </template>
      </div>
    </li>
  </ul>
</template>

<style scoped>
.list { list-style: none; margin: 0; padding: 0; }
.card-link { display: block; color: inherit; text-decoration: none; }
.excerpt { display: -webkit-box; -webkit-line-clamp: 2; line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; margin: 2px 0; }
.unread strong::before { content: '●'; color: var(--accent); margin-right: 6px; }
.status { margin: 8px 0 0; color: var(--muted); }
.quick { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 10px; }
.quick > * { flex: 1 1 auto; }
.quick-link { display: inline-flex; align-items: center; justify-content: center; min-height: 44px; padding: 0 16px; border: 1px solid var(--accent); border-radius: 10px; color: var(--accent); text-decoration: none; box-sizing: border-box; }
</style>
