<script lang="ts">
import { defineComponent } from 'vue'
import type { PropType } from 'vue'
import type { GraphNodeKind } from '../contracts/graphs'
import { kindLabels } from './utils/graph-kinds'
import { label, t } from './i18n'
import { outcomeText } from './utils/item-trace'
import type { TraceRow } from './utils/item-trace'

export default defineComponent({
  props: {
    title: { type: String, default: '' },
    rows: { type: Array as PropType<TraceRow[]>, default: () => [] },
    items: { type: Array as PropType<{ key: string, title: string, outcome: string, node: string }[]>, default: () => [] },
    names: { type: Object as PropType<Record<string, string>>, default: () => ({}) },
  },
  emits: ['open', 'back', 'openGate'],
  methods: { t, label, outcome(value: string) { return label(outcomeText(value)) }, kindLabel(kind: GraphNodeKind) { return t(kindLabels[kind]) } },
})
</script>

<template>
  <section class="item-trace">
    <template v-if="title">
      <header>
        <div>
          <small>{{ t('Item trace') }}</small>
          <h2>{{ title }}</h2>
        </div>
        <button class="text-button" @click="$emit('back')">
          {{ t('Back to the graph') }}
        </button>
      </header>
      <ol>
        <li v-for="(row, index) in rows" :key="index" :data-kind="row.kind" :data-open="row.open">
          <span class="item-trace-node"><strong>{{ row.name }}</strong><small>{{ kindLabel(row.kind) }}</small></span>
          <span class="item-trace-text">{{ outcome(row.outcome) }}<template v-if="row.text">: {{ row.text }}</template></span>
          <button v-if="row.open" class="text-button" @click="$emit('openGate', row.node.slice(5))">
            {{ t('Open approval') }}
          </button>
          <span v-else class="item-trace-detail">{{ row.detail }}</span>
        </li>
      </ol>
      <p v-if="!rows.length" class="muted">
        {{ t('No step is recorded for this item.') }}
      </p>
    </template>
    <template v-else>
      <h2>{{ t('Items of the last runs') }}</h2>
      <p v-if="!items.length" class="muted">
        {{ t('No item has passed this graph yet.') }}
      </p>
      <button v-for="item in items" :key="item.key" class="inventory-row" @click="$emit('open', item.key)">
        <span><strong>{{ item.title }}</strong><small>{{ outcome(item.outcome) }} · {{ names[item.node] ?? item.node }}</small></span><span aria-hidden="true">›</span>
      </button>
    </template>
  </section>
</template>

<style>
.item-trace{display:flex;flex-direction:column;gap:12px;min-width:0}
.item-trace header{display:flex;align-items:flex-start;justify-content:space-between;gap:16px}
.item-trace header small{font-size:12px;font-weight:650;color:var(--muted)}
.item-trace h2{margin:0;font-size:18px;overflow-wrap:anywhere}
.item-trace ol{display:flex;flex-direction:column;gap:8px;margin:0;padding:0;list-style:none}
.item-trace li{display:flex;flex-wrap:wrap;align-items:center;gap:8px 16px;padding:12px 16px;border:1px solid var(--border);border-radius:10px;background:var(--surface)}
.item-trace li[data-kind="decision"]{background:var(--tint);border-color:light-dark(#9db8a2,#55705a)}
.item-trace li[data-kind="effect"]{background:light-dark(#326747,#9ac4a0);border-color:light-dark(#326747,#9ac4a0);color:light-dark(#fff,#132a1d)}
.item-trace li[data-kind="gate"]{background:light-dark(#f6ead3,#4a3a1c);border-color:var(--warn);color:light-dark(#4a2f08,#f6ead3)}
.item-trace li[data-open="true"]{border-style:dashed}
.item-trace-node{display:flex;flex-direction:column;flex:0 0 190px;min-width:0}
.item-trace-node small{font-size:12px;opacity:.85}
.item-trace-text{flex:1 1 200px;min-width:0;overflow-wrap:anywhere}
.item-trace-detail{flex:0 0 auto;font-size:13px;opacity:.85}
</style>
