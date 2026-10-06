<script setup lang="ts">
import { computed } from 'vue'
import type { MapView } from '../../contracts/map-view'
import { diagnostic, t } from '../i18n'
import { ago, cadence } from '../utils/cadence'
import { buildModel, ungrouped, visibleNodes } from '../utils/automation-layout'
import type { Layers } from '../utils/automation-layout'

/** The same Pods as a table: group, kind, cadence, what they read and write, channels and the last run. */
const props = defineProps<{ view: MapView, group: string, layers: Layers, now: number }>()
const emit = defineEmits<{ open: [id: string] }>()
const rows = computed(() => {
  const model = buildModel(props.view)
  const visible = visibleNodes(model, props.group, props.layers)
  return model.nodes.filter(item => (item.kind === 'pod' || item.kind === 'collapsed') && visible.has(item.id)).map((item) => {
    const pod = props.view.pods.find(pod => pod.id === item.id)
    const collection = props.view.collections.find(collection => collection.id === item.id)
    const name = (id: string) => model.nodes.find(node => node.id === id)?.name ?? id
    const facts = {
      reads: model.links.filter(link => link.type === 'read' && link.to === item.id).map(link => ({ name: name(link.from) })),
      writes: model.links.filter(link => link.type === 'write' && link.from === item.id).map(link => ({ name: name(link.to) })),
      channels: model.links.filter(link => link.type === 'channel' && (link.from === item.id || link.to === item.id)).map(link => ({ direction: link.from === item.id ? 'gives' : 'takes', channel: link.label })),
    }
    return {
      id: item.id, name: item.name, description: pod?.description ?? '', group: item.group === ungrouped ? t('without group') : item.group ?? '',
      kind: item.kind === 'collapsed' ? t('collapsed') : item.ai ? t('AI') : t('rules'),
      cadence: item.kind === 'collapsed' ? cadence(collection?.schedule ?? null) : cadence(pod?.schedule ?? null, pod?.channels.takes),
      reads: facts.reads.map(fact => fact.name).join(', ') || '–', writes: facts.writes.map(fact => fact.name).join(', ') || '–',
      channels: facts.channels.map(fact => `${fact.direction === 'gives' ? '→' : '←'} ${fact.channel}`),
      last: item.paused ? t('paused') : pod?.lastRun ? (pod.lastRun.state === 'running' ? t('running') : `${ago(pod.lastRun.at, props.now)} · ${diagnostic(pod.lastRun.state)}`) : '–',
    }
  })
})
</script>

<template>
  <div class="automations-list">
    <table>
      <thead>
        <tr>
          <th>{{ t('Pod') }}</th><th>{{ t('Group') }}</th><th>{{ t('Kind') }}</th><th>{{ t('Runs on') }}</th><th>{{ t('Reads') }}</th><th>{{ t('Writes') }}</th><th class="mono">
            {{ t('Channels') }}
          </th><th>{{ t('Last') }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="row.id" @click="emit('open', row.id)">
          <td>
            <b>{{ row.name }}</b><div class="automations-list-purpose">
              {{ row.description }}
            </div>
          </td><td>{{ row.group }}</td><td>{{ row.kind }}</td><td>{{ row.cadence }}</td><td>{{ row.reads }}</td><td>{{ row.writes }}</td>
          <td class="mono">
            <template v-if="row.channels.length">
              <div v-for="channel in row.channels" :key="channel">
                {{ channel }}
              </div>
            </template><template v-else>
              –
            </template>
          </td><td>{{ row.last }}</td>
        </tr>
        <tr v-if="!rows.length">
          <td colspan="8" class="muted">
            {{ t('Nothing in this group.') }}
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>

<style>
.automations-list{overflow-x:auto;background:var(--surface);border:1px solid var(--border);border-radius:8px}
.automations-list table{border-collapse:collapse;width:100%;font-size:14px}
.automations-list th,.automations-list td{text-align:left;padding:8px 12px;border-bottom:1px solid var(--border);vertical-align:top}
.automations-list th{font-size:12px;letter-spacing:.06em;text-transform:uppercase;color:var(--muted);font-weight:600}
.automations-list tr:last-child td{border-bottom:0}.automations-list tbody tr{cursor:pointer}
.automations-list .mono{font-family:ui-monospace,Menlo,monospace;font-size:12px}
.automations-list-purpose{font-size:12px;color:var(--muted)}
</style>
