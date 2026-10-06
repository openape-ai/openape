<script lang="ts">
import { defineComponent } from 'vue'
import type { PropType } from 'vue'
import type { GateBatchView, GateHeldItem } from '../contracts/gates'
import type { GraphGate } from '../contracts/graphs'
import { dateTime, diagnostic, label, t } from './i18n'

export default defineComponent({
  props: {
    gate: { type: Object as PropType<GraphGate>, required: true },
    batches: { type: Array as PropType<GateBatchView[]>, default: () => [] },
    held: { type: Array as PropType<GateHeldItem[]>, default: () => [] },
    busy: Boolean,
    readOnly: Boolean,
  },
  emits: ['exclude', 'choose', 'discard', 'approve', 'back'],
  data() { return { excluded: {} as Record<string, string[]> } },
  computed: {
    open(): GateBatchView[] { return this.batches.filter(batch => ['preparing', 'pending', 'consuming', 'unknown'].includes(batch.state)) },
    closed(): GateBatchView[] { return this.batches.filter(batch => !this.open.includes(batch)) },
  },
  methods: {
    t, label, diagnostic, dateTime,
    toggle(batch: string, item: string) {
      const current = this.excluded[batch] ?? []
      this.excluded = { ...this.excluded, [batch]: current.includes(item) ? current.filter(id => id !== item) : [...current, item] }
    },
    included(batch: GateBatchView): number { return batch.items.length - (this.excluded[batch.id]?.length ?? 0) },
    exclude(batch: GateBatchView) { this.$emit('exclude', batch.id, this.excluded[batch.id] ?? []); this.excluded = { ...this.excluded, [batch.id]: [] } },
  },
})
</script>

<template>
  <section class="gate-review">
    <header>
      <div>
        <small>{{ gate.kind === 'approve' ? t('Collective approval') : t('Review') }}</small>
        <h2>{{ gate.title }}</h2>
      </div>
      <button class="text-button" @click="$emit('back')">
        {{ t('Back to the graph') }}
      </button>
    </header>

    <template v-if="gate.kind === 'choose'">
      <p v-if="!held.length" class="muted">
        {{ t('Nothing waits for your decision.') }}
      </p>
      <article v-for="item in held" :key="item.itemId" class="gate-item">
        <strong>{{ item.title }}</strong>
        <div class="gate-options">
          <button v-for="option in gate.options" :key="option.key" class="secondary" :disabled="busy || readOnly" @click="$emit('choose', item.itemId, option.key)">
            {{ option.title }}
          </button>
        </div>
      </article>
    </template>

    <template v-else>
      <p v-if="!open.length" class="muted">
        {{ t('No batch waits for your approval.') }}
      </p>
      <article v-for="batch in open" :key="batch.id" class="gate-batch" :data-state="batch.state">
        <p class="gate-state">
          <strong>{{ label(batch.state) }}</strong> · {{ t('Items: {count}', { count: batch.items.length }) }} · {{ t('valid until {time}', { time: dateTime(batch.expiresAt) }) }}
        </p>
        <p v-if="batch.error" role="alert" class="error-message">
          {{ diagnostic(batch.error) }}
        </p>
        <label v-for="item in batch.items" :key="item.itemId" class="gate-row">
          <input v-if="!readOnly" type="checkbox" :checked="!(excluded[batch.id] ?? []).includes(item.itemId)" :disabled="batch.state !== 'pending' || busy || readOnly" @change="toggle(batch.id, item.itemId)">
          <span>{{ item.title }}</span>
        </label>
        <p class="muted">
          {{ gate.excluded ? t('Excluded items leave the batch and continue on {channel}.', { channel: gate.excluded }) : t('Excluded items leave the batch and stay where they are.') }}
        </p>
        <div class="gate-actions">
          <button v-if="batch.state === 'unknown'" class="secondary" :disabled="busy || readOnly" @click="$emit('discard', batch.id)">
            {{ t('Discard batch; nothing is handed on') }}
          </button>
          <template v-else-if="batch.state === 'pending'">
            <button v-if="excluded[batch.id]?.length && !readOnly" class="secondary" :disabled="busy || readOnly || included(batch) === batch.items.length" @click="exclude(batch)">
              {{ t('Exclude ({count}) and request approval again', { count: excluded[batch.id]!.length }) }}
            </button>
            <a v-else-if="readOnly && batch.url?.startsWith('https://')" class="primary" :href="batch.url" target="_blank" rel="noopener noreferrer">{{ t('Approve at the identity provider ({count})', { count: batch.items.length }) }}</a>
            <button v-else class="primary" :disabled="busy || !batch.url" @click="$emit('approve', batch.id)">
              {{ t('Approve at the identity provider ({count})', { count: batch.items.length }) }}
            </button>
          </template>
        </div>
      </article>
      <details v-if="closed.length">
        <summary>{{ t('Earlier batches') }}</summary>
        <p v-for="batch in closed" :key="batch.id">
          {{ label(batch.state) }} · {{ t('Items: {count}', { count: batch.items.length }) }}
        </p>
      </details>
    </template>
  </section>
</template>

<style>
.gate-review{display:flex;flex-direction:column;gap:14px;min-width:0}
.gate-review header{display:flex;align-items:flex-start;justify-content:space-between;gap:16px}
.gate-review header small{font-size:12px;font-weight:650;color:var(--warn)}
.gate-review h2{margin:0;font-size:18px}
.gate-batch,.gate-item{display:flex;flex-direction:column;gap:6px;padding:16px;border:1px solid var(--border);border-radius:12px;background:var(--surface)}
.gate-batch[data-state="unknown"]{border-color:var(--warn)}
.gate-state{margin:0}
.gate-row{display:flex;align-items:center;gap:12px;min-height:44px;border-top:1px solid var(--border);overflow-wrap:anywhere}
.gate-row input{flex:0 0 auto;width:20px;height:20px;accent-color:var(--accent)}
.gate-row span{min-width:0}
.gate-actions,.gate-options{display:flex;flex-wrap:wrap;gap:12px}
</style>
