<script setup lang="ts">
import { computed } from 'vue'
import type { MapView } from '../../contracts/map-view'
import { t } from '../i18n'
import { buildModel, visibleNodes } from '../utils/automation-layout'
import type { Layers } from '../utils/automation-layout'
import { failureCount, lastResult, nextRun, podState, waitsFor } from '../utils/pod-status'
import type { PodState } from '../utils/pod-status'
import { tagsOf } from '../utils/tags'

/** One row per Pod: what it does, how it is doing, its last result, its next run and what it waits for. */
const props = defineProps<{ view: MapView, layers: Layers, now: number }>()
const emit = defineEmits<{ open: [id: string] }>()
const stateLabels: Record<PodState, string> = { failing: 'Error', waiting: 'Waits for you', running: 'Running', paused: 'paused', ok: 'OK' }
const rows = computed(() => {
  const visible = visibleNodes(buildModel(props.view), props.layers)
  return props.view.pods.filter(pod => visible.has(pod.id)).map(pod => ({
    id: pod.id, name: pod.name, purpose: pod.description ?? '', tags: tagsOf(props.view, pod.id),
    state: podState(pod, props.view), result: lastResult(pod, props.now), failures: failureCount(pod), next: nextRun(pod, props.now), waits: waitsFor(pod, props.view),
  }))
})
</script>

<template>
  <div class="automations-list">
    <table>
      <thead>
        <tr>
          <th>{{ t('Pod') }}</th><th>{{ t('State') }}</th><th>{{ t('Last result') }}</th><th>{{ t('Next run') }}</th><th>{{ t('Waits for') }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="row.id" :data-pod="row.id" @click="emit('open', row.id)">
          <td class="pod-cell">
            <b>{{ row.name }}</b>
            <div class="automations-list-purpose" :class="{ missing: !row.purpose }">
              {{ row.purpose || t('Purpose missing') }}
            </div>
            <div v-if="row.tags.own.length" class="tag-chips">
              <span v-for="tag in row.tags.own" :key="tag" class="tag">{{ tag }}</span>
            </div>
          </td>
          <td :data-label="t('State')">
            <span class="state-chip" :data-state="row.state">{{ t(stateLabels[row.state] as 'OK') }}</span>
          </td>
          <td class="result-cell" :data-state="row.state" :data-label="t('Last result')">
            {{ row.result }}
            <small v-if="row.failures" class="failures">{{ row.failures }}</small>
          </td>
          <td :data-label="t('Next run')">
            {{ row.next }}
          </td>
          <td :data-label="t('Waits for')">
            {{ row.waits || '–' }}
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td colspan="5" class="muted">
            {{ t('Nothing matches the filter.') }}
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>

<style>
.automations-list{overflow-x:auto;background:var(--surface);border:1px solid var(--border);border-radius:8px}
.automations-list table{border-collapse:collapse;width:100%;font-size:14px}
.automations-list th,.automations-list td{text-align:left;padding:10px 12px;border-bottom:1px solid var(--border);vertical-align:top}
.automations-list th{font-size:12px;letter-spacing:.06em;text-transform:uppercase;color:var(--muted);font-weight:600;white-space:nowrap}
.automations-list tr:last-child td{border-bottom:0}.automations-list tbody tr{cursor:pointer}.automations-list tbody tr:hover{background:var(--tint)}
.automations-list .pod-cell{min-width:240px;max-width:420px}
.automations-list-purpose{font-size:13px;color:var(--muted);margin-top:2px}.automations-list-purpose.missing{font-style:italic;color:var(--warn)}
.automations-list .result-cell{max-width:420px;overflow-wrap:anywhere}.automations-list .result-cell[data-state="failing"]{color:var(--bad)}
.automations-list .result-cell .failures{display:block;margin-top:2px;font-size:12px;font-weight:600;color:var(--bad)}
.automations-list .state-chip{display:inline-block;white-space:nowrap;font-size:12px;font-weight:600;padding:2px 8px;border-radius:999px;background:var(--tint);color:var(--muted)}
.automations-list .state-chip[data-state="ok"],.automations-list .state-chip[data-state="running"]{background:var(--ok-soft);color:var(--ok)}
.automations-list .state-chip[data-state="failing"]{background:var(--bad-soft);color:var(--bad)}
.automations-list .state-chip[data-state="waiting"]{background:var(--warn-soft);color:var(--warn)}
/* Phones: each Pod becomes a card with labelled lines instead of a sideways-scrolling table. */
@media(max-width:700px){
  .automations-list thead{display:none}
  .automations-list table,.automations-list tbody,.automations-list tr,.automations-list td{display:block;width:auto}
  .automations-list tr{border-bottom:1px solid var(--border);padding:6px 0}.automations-list tr:last-child{border-bottom:0}
  .automations-list td{border:0;padding:4px 12px}.automations-list .pod-cell{min-width:0;max-width:none}
  .automations-list td[data-label]::before{content:attr(data-label) ": ";font-size:12px;color:var(--muted)}
}
</style>
