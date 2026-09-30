<script lang="ts">
import { defineComponent } from 'vue'
import type { PropType } from 'vue'
import type { GateBatchView } from '../contracts/gates'
import type { GraphChannel, GraphContract, GraphGate, GraphNodeKind, GraphRight } from '../contracts/graphs'
import { kindLabels } from './utils/graph-kinds'
import { label, t } from './i18n'

export interface InspectedNode { id: string, name: string, kind: GraphNodeKind, contract: GraphContract | null, gate: GraphGate | null, rights: GraphRight[], approval: string | null, counts: { received: number, given: number, waiting: number } }

export default defineComponent({
  props: {
    node: { type: Object as PropType<InspectedNode>, required: true },
    channels: { type: Array as PropType<GraphChannel[]>, default: () => [] },
    run: Boolean,
    batches: { type: Array as PropType<GateBatchView[]>, default: () => [] },
  },
  emits: ['openPod', 'openGate'],
  computed: {
    takes(): string[] { return this.node.gate ? [this.node.gate.takes] : this.node.contract?.takes ?? [] },
    gives(): string[] {
      const gate = this.node.gate
      if (!gate) return this.node.contract?.gives ?? []
      return gate.kind === 'approve' ? [gate.gives, ...gate.excluded ? [gate.excluded] : []] : gate.options.map(option => option.channel)
    },
    approval(): string {
      if (this.node.gate) return t(this.node.gate.kind === 'approve' ? 'One approval for the whole batch' : 'One decision per item')
      return this.node.approval ? t('Runs only after the approval "{gate}"', { gate: this.node.approval }) : t('None')
    },
    waiting(): number { return this.batches.filter(batch => batch.state === 'pending').reduce((sum, batch) => sum + batch.items.length, 0) },
  },
  methods: { t, label, channelTitle(name: string) { return this.channels.find(channel => channel.name === name)?.title || name }, kindLabel(kind: GraphNodeKind) { return t(kindLabels[kind]) } },
})
</script>

<template>
  <aside class="graph-inspector" :aria-label="t('Selected node')">
    <header>
      <small>{{ kindLabel(node.kind) }}</small>
      <h2>{{ node.name }}</h2>
      <p v-if="node.contract">
        {{ node.contract.summary }}
      </p>
      <p v-else-if="!node.gate" class="error-message">
        {{ t('The active script exports no contract.') }}
      </p>
    </header>
    <section>
      <h3>{{ t('Receives') }}</h3>
      <p v-for="name in takes" :key="name">
        {{ channelTitle(name) }}<small v-if="channelTitle(name) !== name" class="graph-channel-name">{{ name }}</small>
      </p>
      <p v-if="!takes.length">
        {{ t('Nothing, starts with the network') }}
      </p>
    </section>
    <section>
      <h3>{{ t('Produces') }}</h3>
      <p v-for="name in gives" :key="name">
        {{ channelTitle(name) }}<small v-if="channelTitle(name) !== name" class="graph-channel-name">{{ name }}</small>
      </p>
      <p v-if="!gives.length">
        {{ t('Nothing') }}
      </p>
    </section>
    <section v-if="!node.gate">
      <h3>{{ t('Allowed actions') }}</h3>
      <ul v-if="node.rights.length">
        <li v-for="(right, index) in node.rights" :key="index">
          {{ right.target ? `${label(right.label)}: ${right.target}` : label(right.label) }}
        </li>
      </ul>
      <p v-else>
        {{ t('Nothing beyond its own folder') }}
      </p>
    </section>
    <section>
      <h3>{{ t('Approval') }}</h3>
      <p>{{ approval }}</p>
    </section>
    <section v-if="run">
      <h3>{{ t('Last run') }}</h3>
      <p>{{ t('In: {received} · out: {given}', { received: node.counts.received, given: node.counts.given }) }}</p>
      <p v-if="node.counts.waiting">
        {{ t('Waiting: {count}', { count: node.counts.waiting }) }}
      </p>
    </section>
    <button v-if="node.gate" class="primary" @click="$emit('openGate', node.gate.key)">
      {{ waiting ? t('Open approval ({count})', { count: waiting }) : t('Open approval') }}
    </button>
    <button v-else class="secondary" @click="$emit('openPod', node.id)">
      {{ t('Open pod: script, rights, values') }}
    </button>
  </aside>
</template>

<style>
.graph-inspector{box-sizing:border-box;display:flex;flex-direction:column;gap:14px;min-width:0;padding:20px;border:1px solid var(--border);border-radius:12px;background:var(--surface)}
.graph-inspector header small,.graph-inspector h3{margin:0;font-size:12px;font-weight:650;color:var(--muted)}
.graph-inspector h2{margin:2px 0 4px;font-size:18px}
.graph-inspector p,.graph-channel-name{display:block;font-size:12px;color:var(--muted)}
.graph-inspector ul{margin:2px 0 0;overflow-wrap:anywhere}
.graph-channel-name{display:block;font-size:12px;color:var(--muted)}
.graph-inspector ul{padding-left:18px}
</style>
