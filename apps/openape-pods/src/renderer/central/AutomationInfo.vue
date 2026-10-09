<script setup lang="ts">
import { computed } from 'vue'
import type { MapView } from '../../contracts/map-view'
import { diagnostic, language, t } from '../i18n'
import { ago, cadence, stamp } from '../utils/cadence'
import { nodeFacts, YOU } from '../utils/automation-layout'

/** The pinned or hovered node as text: what it is, how it ran, what it reads, writes and exchanges. */
const props = defineProps<{ view: MapView, id: string | null, pinned: boolean, now: number }>()
defineEmits<{ open: [id: string] }>()
const pod = computed(() => props.view.pods.find(item => item.id === props.id) ?? null)
const automation = computed(() => props.view.automations.find(item => item.id === props.id) ?? null)
const system = computed(() => props.view.systems.find(item => item.id === props.id) ?? null)
const facts = computed(() => props.id ? nodeFacts(props.view, props.id) : null)
const title = computed(() => props.id === YOU ? t('You · Pods inbox') : props.id === 'auth:idp' ? 'id.openape.ai' : pod.value?.name ?? automation.value?.name ?? system.value?.name ?? props.id ?? '')
const how = computed(() => system.value ? (system.value.kind === 'application' ? `${system.value.how} · ${t('installed')}` : system.value.kind === 'service' ? `${t('https')} · ${system.value.how}` : system.value.how) : props.id === YOU ? t('questions, rules') : props.id === 'auth:idp' ? t('Identity provider. Decides execution rights and approval batches.') : '')
const run = computed(() => pod.value?.lastRun ?? automation.value?.lastRun ?? null)
const list = (items: { name: string, flow: number }[]) => items.map(item => `${item.name} (${item.flow})`).join(', ')
</script>

<template>
  <aside class="automation-info" aria-live="polite">
    <span v-if="!id" class="hint">{{ t('Click a node. Double-click or "Open details" shows the detail page.') }}</span>
    <template v-else>
      <h3>{{ title }}<span v-if="pinned" class="pin">{{ t('pinned') }}</span></h3>
      <div v-if="how" class="k">
        {{ how }}
      </div>
      <div v-if="pod?.description">
        {{ pod.description }}
      </div>
      <div v-if="pod" class="k">
        {{ cadence(pod.schedule, pod.channels.takes) }}<template v-if="pod.runs">
          · {{ t('{count} runs in total', { count: pod.runs }) }}
        </template>
      </div>
      <div v-if="run" class="k">
        {{ t('last') }} {{ stamp(run.at, language) }} · {{ diagnostic(run.state) }}: {{ run.summary }}
      </div>
      <div v-else-if="pod" class="k">
        {{ t('no own run in the window (only on items)') }}
      </div>
      <div v-if="automation" class="k">
        {{ t('{count} members', { count: automation.members.length }) }} · {{ automation.state === 'active' ? t('active') : t('paused') }}<template v-if="automation.lastRun">
          · {{ ago(automation.lastRun.at, now) }}
        </template>
      </div>
      <div v-if="facts?.channels.length" class="k">
        {{ t('Channels') }}: {{ facts.channels.map(item => `${item.direction === 'gives' ? '→' : '←'} ${item.channel} (${item.flow})`).join(', ') }}
      </div>
      <div v-if="facts?.reads.length" class="k">
        {{ t('reads') }}: {{ list(facts.reads) }}
      </div>
      <div v-if="facts?.writes.length" class="k">
        {{ t('writes') }}: {{ list(facts.writes) }}
      </div>
      <div v-if="pinned && (pod || automation)" class="opts">
        <button class="primary" type="button" @click="$emit('open', id!)">
          {{ t('Open details') }}
        </button>
      </div>
    </template>
  </aside>
</template>

<style>
.automation-info{background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:12px 14px;font-size:13px;line-height:1.45;min-height:120px;position:sticky;top:60px;min-width:0;overflow-wrap:anywhere}
.automation-info h3{font-size:14px;margin:0 0 4px;display:flex;justify-content:space-between;gap:8px;align-items:center}
.automation-info .k{color:var(--muted);margin-top:6px}
.automation-info .pin{font-size:11px;color:var(--accent);font-weight:600}
.automation-info .hint{color:var(--muted)}
.automation-info .opts{margin-top:8px}
</style>
