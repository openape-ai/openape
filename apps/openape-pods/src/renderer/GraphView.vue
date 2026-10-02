<script lang="ts">
import { defineComponent } from 'vue'
import type { PropType } from 'vue'
import type { StoredPod } from '../contracts/control'
import type { GraphDetail, GraphNodeKind } from '../contracts/graphs'
import type { WorkflowDefinition } from '../contracts/workflows'
import { diagnostic, t } from './i18n'
import { edgeCounts, nodeCounts } from './utils/graph-counts'
import { edgePath, layoutGraph, nodeSize } from './utils/graph-layout'
import { kindLabels } from './utils/graph-kinds'

export default defineComponent({
  props: {
    definition: { type: Object as PropType<WorkflowDefinition>, required: true },
    detail: { type: Object as PropType<GraphDetail>, required: true },
    pods: { type: Array as PropType<StoredPod[]>, required: true },
    structureOnly: Boolean,
    selected: { type: String, default: '' },
    mode: { type: String as PropType<'plan' | 'run'>, default: 'plan' },
  },
  emits: ['select', 'mode'],
  computed: {
    ids(): string[] { return [...this.definition.nodes.map(node => node.podId), ...this.definition.gates.map(gate => `gate:${gate.key}`)] },
    layout() { return layoutGraph(this.ids, this.detail.edges) },
    counted() { return edgeCounts(this.detail.edges, this.detail.counts) },
    edges() {
      return this.layout.edges.map((edge, index) => {
        const middle = edge.points[Math.floor(edge.points.length / 2)]!
        return { ...edge, path: edgePath(edge.points), count: this.counted[index]?.count ?? 0, x: middle[0], y: middle[1] }
      })
    },
    nodes() {
      return this.layout.nodes.map((node) => {
        const gate = this.definition.gates.find(item => `gate:${item.key}` === node.id)
        const kind: GraphNodeKind = this.detail.nodeKinds[node.id] ?? (gate ? 'gate' : 'code')
        const counts = nodeCounts(node.id, this.counted, this.detail.waiting)
        return { ...node, kind, name: gate?.title ?? this.pods.find(pod => pod.id === node.id)?.name ?? node.id, plan: gate ? t(gate.kind === 'approve' ? 'You approve the batch' : 'You choose per item') : this.detail.contracts[node.id]?.summary ?? '', counts, faulty: this.detail.diagnostics.some(item => item.node === node.id) }
      })
    },
    size() { return { width: `${this.layout.width}px`, height: `${this.layout.height}px` } },
    box() { return { width: `${nodeSize.width}px`, height: `${nodeSize.height}px` } },
  },
  methods: {
    t, diagnostic,
    channelLabel(name: string) {
      const title = this.definition.channels.find(channel => channel.name === name)?.title
      return title && title !== name ? `${title} (${name})` : name
    },
    kindLabel(kind: GraphNodeKind) { return t(kindLabels[kind]) },
    runLine(counts: { received: number, given: number, waiting: number }) {
      if (counts.waiting) return t('Waiting: {count}', { count: counts.waiting })
      if (counts.received || counts.given) return t('In: {received} · out: {given}', { received: counts.received, given: counts.given })
      return t('Nothing to do')
    },
  },
})
</script>

<template>
  <section class="graph-view">
    <header class="graph-toolbar">
      <ul v-if="!structureOnly" class="graph-legend" :aria-label="t('Kinds of nodes')">
        <li v-for="kind in (['code', 'decision', 'effect', 'gate'] as const)" :key="kind">
          <span class="graph-swatch" :data-kind="kind" aria-hidden="true" />{{ kindLabel(kind) }}
        </li>
      </ul>
      <div v-if="!structureOnly" class="graph-modes" role="group" :aria-label="t('Graph view')">
        <button :aria-pressed="mode === 'plan'" @click="$emit('mode', 'plan')">
          {{ t('Structure') }}
        </button><button :aria-pressed="mode === 'run'" :disabled="!detail.lastRun" @click="$emit('mode', 'run')">
          {{ t('Last run') }}
        </button>
      </div>
    </header>
    <p class="muted graph-view-explanation">
      {{ t(mode === 'plan' ? 'Structure shows which Pods can exchange work.' : 'Last run shows recorded deliveries, not confirmed external effects. Zero-count paths remain visible.') }}
    </p>
    <p v-if="!ids.length" class="muted">
      {{ t('This graph has no nodes yet.') }}
    </p>
    <div v-else class="graph-scroll" tabindex="0" role="group" :aria-label="t('Graph')">
      <div class="graph-canvas" :style="size">
        <svg class="graph-edges" :data-mode="mode" :width="layout.width" :height="layout.height" aria-hidden="true">
          <path v-for="edge in edges" :key="`${edge.from}:${edge.to}:${edge.channel}`" :d="edge.path" :data-active="mode === 'run' && edge.count > 0" />
        </svg>
        <template v-if="mode === 'run'">
          <span v-for="edge in edges.filter(item => item.count)" :key="`count:${edge.from}:${edge.to}:${edge.channel}`" class="graph-count" :style="{ left: `${edge.x}px`, top: `${edge.y}px` }" :title="channelLabel(edge.channel)">{{ edge.count }}</span>
        </template>
        <button v-for="node in nodes" :key="node.id" class="graph-node" :data-kind="node.kind" :data-faulty="node.faulty" :aria-pressed="selected === node.id" :style="{ ...box, left: `${node.x}px`, top: `${node.y}px` }" @click="$emit('select', node.id)">
          <strong>{{ node.name }}</strong>
          <small>{{ mode === 'run' ? runLine(node.counts) : node.plan }}</small>
        </button>
      </div>
    </div>
    <ul v-if="detail.diagnostics.length" class="graph-diagnostics" role="alert">
      <li v-for="(item, index) in detail.diagnostics" :key="index">
        <button class="text-button" :disabled="!item.node" @click="$emit('select', item.node)">
          {{ diagnostic(item.message) }}<template v-if="item.channel">
            · {{ item.channel }}
          </template>
        </button>
      </li>
    </ul>
  </section>
</template>

<style>
.graph-view{display:flex;flex-direction:column;gap:12px;min-width:0}
.graph-toolbar{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:12px}
.graph-legend{display:flex;flex-wrap:wrap;gap:6px 16px;margin:0;padding:0;list-style:none;font-size:13px;color:var(--muted)}
.graph-legend li{display:flex;align-items:center;gap:6px}
.graph-swatch{box-sizing:border-box;width:14px;height:14px;border-radius:4px;border:1px solid var(--border);background:var(--surface)}
.graph-swatch[data-kind="decision"],.graph-node[data-kind="decision"]{background:var(--tint);border-color:light-dark(#9db8a2,#55705a)}
.graph-swatch[data-kind="effect"],.graph-node[data-kind="effect"]{background:light-dark(#326747,#9ac4a0);border-color:light-dark(#326747,#9ac4a0);color:light-dark(#fff,#132a1d)}
.graph-swatch[data-kind="gate"],.graph-node[data-kind="gate"]{background:light-dark(#f6ead3,#4a3a1c);border-color:var(--warn);color:light-dark(#4a2f08,#f6ead3)}
.graph-modes{display:flex;gap:4px;padding:4px;border:1px solid var(--border);border-radius:10px;background:var(--surface)}
.graph-modes button{min-height:36px;padding:0 14px;border:0;border-radius:7px;background:transparent;color:var(--text);font:inherit;font-weight:600;cursor:pointer}
.graph-modes button[aria-pressed="true"]{background:light-dark(#326747,#9ac4a0);color:light-dark(#fff,#132a1d)}
.graph-modes button:disabled{color:var(--muted);cursor:default}
.graph-scroll{max-width:100%;overflow:auto;border:1px solid var(--border);border-radius:12px;background:var(--bg)}
.graph-canvas{position:relative}
.graph-edges{position:absolute;inset:0;pointer-events:none}
.graph-edges path{fill:none;stroke:var(--muted);stroke-width:1.5}
.graph-view-explanation{margin:0;font-size:13px;line-height:1.5}
.graph-edges[data-mode="run"] path[data-active="false"]{opacity:.45;stroke-dasharray:4 4}
.graph-edges path[data-active="true"]{stroke:var(--accent);stroke-width:2.5}
.graph-node{position:absolute;box-sizing:border-box;display:flex;flex-direction:column;justify-content:center;gap:2px;padding:6px 12px;overflow:hidden;border:1px solid var(--border);border-radius:10px;background:var(--surface);color:var(--text);font:inherit;text-align:left;cursor:pointer}
.graph-node strong,.graph-node small{overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
.graph-node small{font-size:12px;opacity:.85}
.graph-node[aria-pressed="true"]{box-shadow:0 0 0 3px var(--text)}
.graph-node[data-faulty="true"]{border-style:dashed;border-width:2px}
.graph-count{position:absolute;transform:translate(-50%,-50%);min-width:22px;padding:1px 6px;border:1px solid var(--border);border-radius:9px;background:var(--surface);color:var(--text);font-size:12px;font-weight:600;text-align:center}
.graph-diagnostics{margin:0;padding:0;list-style:none;color:var(--warn)}
</style>
