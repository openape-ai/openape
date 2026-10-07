<script setup lang="ts">
import { computed } from 'vue'
import { blocking } from '../inbox/client'
import type { InboxItem, PendingAnswer, Receipt } from '../inbox/client'
import { formatTime, t } from '../inbox/i18n'
import { receiptText } from '../inbox/receipt'
import { cardSummary } from '../inbox/card'

const props = defineProps<{ items: InboxItem[], empty: string, receipts?: Record<string, Receipt>, pending?: Record<string, PendingAnswer>, online?: boolean, actions?: boolean }>()
const emit = defineEmits<{ decide: [item: InboxItem, option: string], undo: [item: InboxItem] }>()
const cards = computed(() => props.items.map(item => ({ item, summary: cardSummary(item) })))
// Pods decisions can be answered on the card; an option that needs evidence or a value opens the detail with it preselected.
// Once shown, the answer area keeps its height: a status covers the choices instead of removing them, so cards below never move under a finger.
const choices = (item: InboxItem) => props.actions && item.kind === 'decision' && item.decision?.authority === 'pods' ? item.decision.options : []
function cover(item: InboxItem): string | null {
  const pending = props.pending?.[item.id]
  if (pending) return t('pendingSend', { option: pending.title })
  const receipt = props.receipts?.[item.id]
  if (receipt && (blocking(receipt, item) || item.state !== 'open')) return receiptText(receipt)
  return item.state === 'open' ? null : t('itemResolved')
}
</script>

<template>
  <p v-if="!items.length" class="inbox-muted">
    {{ empty }}
  </p>
  <ul v-else class="list">
    <li v-for="{ item, summary } in cards" :key="item.id" class="inbox-card" :class="{ unread: item.kind === 'message' && !item.read }">
      <NuxtLink class="card-link" :class="{ 'has-sender': summary.sender }" :to="`/inbox/item/${item.id}`">
        <span v-if="item.kind === 'message' && !item.read" class="visually-hidden">{{ t('unread') }}: </span>
        <strong v-if="summary.sender" class="sender"><span class="visually-hidden">{{ t('cardSender') }}: </span>{{ summary.sender }}</strong>
        <strong class="title">{{ item.title }}</strong>
        <span v-if="summary.excerpt" class="excerpt">{{ summary.excerpt }}</span>
        <small>
          <template v-for="hint in summary.hints" :key="hint">{{ hint }} · </template><template v-if="item.pod?.name">{{ t('itemPod', { name: item.pod.name }) }} · </template>{{ formatTime(item.created) }}
          <template v-if="receipts?.[item.id]?.state === 'applied' && item.state !== 'open'"> · {{ t('receiptAppliedShort', { option: receipts[item.id]!.title }) }}</template>
        </small>
      </NuxtLink>
      <p v-if="!choices(item).length && item.state === 'open' && receipts?.[item.id]" class="status" role="status">
        {{ receiptText(receipts[item.id]) }}
      </p>
      <div v-if="choices(item).length" class="answer">
        <div class="quick" role="group" :aria-label="t('decideOn', { title: item.title })" :inert="!!cover(item)" :class="{ covered: cover(item) }">
          <template v-for="option in choices(item)" :key="option.key">
            <NuxtLink v-if="option.input" class="quick-link" :to="{ path: `/inbox/item/${item.id}`, query: { option: option.key } }">
              {{ option.title }} …
            </NuxtLink>
            <button v-else type="button" class="secondary" :disabled="!online" @click="emit('decide', item, option.key)">
              {{ option.title }}
            </button>
          </template>
        </div>
        <div v-if="cover(item)" class="cover" role="status">
          <span>{{ cover(item) }}</span>
          <button v-if="pending?.[item.id]" type="button" @click="emit('undo', item)">
            {{ t('undo') }}
          </button>
        </div>
      </div>
    </li>
  </ul>
</template>

<style scoped>
.list { list-style: none; margin: 0; padding: 0; }
.card-link { display: grid; gap: 2px; color: inherit; text-decoration: none; font-size: .9em; }
.card-link .sender { font-size: 1.05em; }
.has-sender .title { font-weight: 400; }
.excerpt { display: -webkit-box; -webkit-line-clamp: 2; line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; margin: 2px 0; }
.unread .card-link > strong:first-of-type::before { content: '●'; color: var(--accent); margin-right: 6px; }
.status { margin: 8px 0 0; color: var(--muted); }
/* The cover lies over the choices and never takes space of its own; the minimum fits two status lines. */
.answer { position: relative; margin-top: 8px; min-height: 56px; }
.quick { display: flex; flex-wrap: wrap; gap: 6px; font-size: .85em; }
.quick.covered { visibility: hidden; }
.cover { position: absolute; inset: 0; overflow: hidden; display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 4px 10px; border-radius: 10px; background: var(--bg); font-size: .85em; line-height: 1.3; }
.cover span { display: -webkit-box; -webkit-line-clamp: 2; line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.cover button { min-height: 44px; flex: none; }
.quick > * { flex: 1 1 40%; padding: 0 10px; }
.quick-link { display: inline-flex; align-items: center; justify-content: center; text-align: center; min-height: 44px; padding: 0 16px; border: 1px solid var(--accent); border-radius: 10px; color: var(--accent); text-decoration: none; box-sizing: border-box; }
</style>
