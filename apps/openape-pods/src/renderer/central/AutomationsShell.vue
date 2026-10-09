<script setup lang="ts">
import { computed, ref } from 'vue'
import type { MapView } from '../../contracts/map-view'
import { language, t } from '../i18n'
import { clock } from '../utils/cadence'
import AutomationDetail from './AutomationDetail.vue'
import type { NetworkControl, WorkflowControl } from './AutomationDetail.vue'
import AutomationInfo from './AutomationInfo.vue'
import DecisionsInbox from './DecisionsInbox.vue'
import type { GateBatchView, GateHeldItem } from '../../contracts/gates'
import type { NetworkGateView } from '../../contracts/network-gate-view'
import type { NetworkChoiceView, NetworkCommand } from '../../contracts/networks'
import type { WorkflowCommand } from '../../contracts/workflows'
import type { CentralCommand } from '../../contracts/central'
import AutomationsList from './AutomationsList.vue'
import AutomationsMap from './AutomationsMap.vue'
import AppSettingsMenu from './AppSettingsMenu.vue'
import CodexHandoff from './CodexHandoff.vue'
import KpiRow from './KpiRow.vue'
import SecretForm from './SecretForm.vue'
import type { SecretsCommand, SecretsView } from '../../contracts/secrets'
import type { PortableSourceSelection } from '../../contracts/sharing'
import type { Layers } from '../utils/automation-layout'
import { ungrouped } from '../utils/automation-layout'

/**
 * The two product surfaces behind one tab bar: Automatisierungen (this file) and Entscheidungen
 * (the `decisions` slot). Settings open from the gear; creation hands a brief to Codex.
 */
const props = defineProps<{ view: MapView | null, live: boolean, now: number, decisions?: number, tab?: 'automations' | 'decisions', desktop?: boolean, subject?: string, codex?: 'connected' | 'disconnected', inbox?: { choices: NetworkChoiceView[], gates: NetworkGateView[], graphGates: { batches: GateBatchView[], held: GateHeldItem[] } | null }, secrets?: SecretsView | null, sharing?: boolean }>()
const emit = defineEmits<{ 'update:tab': [tab: 'automations' | 'decisions'], 'settings': [], 'logout': [], 'codex': [pinned: string | null, group: string | null], 'command': [command: CentralCommand], 'network': [control: NetworkControl], 'workflow': [control: WorkflowControl], 'secretSave': [podId: string, alias: string, value: string], 'secrets': [command: SecretsCommand], 'folder': [podId: string], 'openPod': [id: string], 'share': [selection: PortableSourceSelection], 'advanced': [], 'import': [], 'networkCommand': [command: NetworkCommand, settle?: (error: string | null) => void], 'workflowCommand': [command: WorkflowCommand] }>()
const mode = ref<'map' | 'list'>('map')
const group = ref('all')
const layers = ref<Layers>({ channel: true, read: true, write: true, auth: true, paused: true })
const playing = ref(true)
const pinned = ref<string | null>(null)
const hovered = ref<string | null>(null)
const detail = ref<string | null>(null)
const handoff = ref(false)
const settings = ref(false)
const secretForm = ref<{ podId: string, alias: string | null } | null>(null)
const inboxView = ref<InstanceType<typeof DecisionsInbox> | null>(null)
const waiting = computed(() => props.decisions ?? inboxView.value?.total ?? 0)
const current = computed(() => props.tab ?? 'automations')
const groups = computed(() => [...new Set([...props.view?.pods.map(pod => pod.group) ?? [], ...props.view?.collections.map(collection => collection.group) ?? []].filter((name): name is string => !!name))])
const chips: { key: keyof Layers, label: string, color: string }[] = [{ key: 'channel', label: 'Channels', color: 'var(--accent)' }, { key: 'read', label: 'Read', color: 'var(--read)' }, { key: 'write', label: 'Write', color: 'var(--warn)' }, { key: 'auth', label: 'Approvals', color: 'var(--idp)' }, { key: 'paused', label: 'Paused', color: 'var(--muted)' }]
function selectGroup(value: string) { group.value = value; pinned.value = null; hovered.value = null }
function openCodex() { handoff.value = true; emit('codex', pinned.value, group.value === 'all' ? null : group.value === ungrouped ? t('without group') : group.value) }
defineExpose({ pin: (id: string | null) => { pinned.value = id }, open: (id: string | null) => { detail.value = id }, group, mode, layers })
</script>

<template>
  <div class="automations-shell">
    <header class="automations-top">
      <nav role="tablist" :aria-label="t('Areas')">
        <button role="tab" :aria-selected="current === 'automations'" @click="emit('update:tab', 'automations')">
          {{ t('Automations') }}
        </button>
        <button role="tab" :aria-selected="current === 'decisions'" @click="emit('update:tab', 'decisions')">
          {{ t('Decisions') }} <span v-if="waiting" class="n">{{ waiting }}</span>
        </button>
      </nav>
      <button class="gear" type="button" :title="t('Settings')" :aria-expanded="settings" @click="settings = !settings">
        ⚙ {{ t('Settings') }}
      </button>
    </header>
    <section v-if="current === 'automations'" role="tabpanel">
      <p v-if="!view" class="muted" role="status">
        {{ t('Loading workspace…') }}
      </p>
      <template v-else>
        <KpiRow :view="view" />
        <div class="automations-toolbar">
          <div class="tb-left">
            <div class="seg" role="group" :aria-label="t('View')">
              <button :aria-pressed="mode === 'map'" @click="mode = 'map'">
                {{ t('Map') }}
              </button><button :aria-pressed="mode === 'list'" @click="mode = 'list'">
                {{ t('List') }}
              </button>
            </div>
            <div class="seg" role="group" :aria-label="t('Group')">
              <button :aria-pressed="group === 'all'" @click="selectGroup('all')">
                {{ t('All') }}
              </button>
              <button v-for="name in groups" :key="name" :aria-pressed="group === name" @click="selectGroup(name)">
                {{ name }}
              </button>
              <button :aria-pressed="group === ungrouped" @click="selectGroup(ungrouped)">
                {{ t('Without group') }}
              </button>
            </div>
          </div>
          <div class="tb-right">
            <div class="layers" role="group" :aria-label="t('Layers')">
              <button v-for="chip in chips" :key="chip.key" class="lay" :aria-pressed="layers[chip.key]" @click="layers[chip.key] = !layers[chip.key]">
                <i :class="{ dash: chip.key === 'paused' }" :style="{ background: chip.color }" />{{ t(chip.label as 'Channels') }}
              </button>
            </div>
            <button class="secondary" type="button" :title="t(playing ? 'Pause animation' : 'Resume animation')" @click="playing = !playing">
              {{ playing ? '❚❚' : '▶' }}
            </button>
            <button class="secondary idp" type="button" @click="openCodex">
              {{ t('New automation with Codex') }}
            </button>
          </div>
        </div>
        <CodexHandoff v-if="handoff" :view="view" :pinned="pinned" :group="group === 'all' ? null : group === ungrouped ? t('without group') : group" :connected="codex === undefined ? null : codex === 'connected'" @close="handoff = false" @settings="settings = true" />
        <div class="automations-kindrow">
          <span class="automations-stamp" :class="{ live }">{{ live ? t('Live · {time}', { time: clock(now, language) }) : t('As of {time}', { time: clock(view.at, language) }) }}</span>
          <div class="kinds">
            <span><i class="k-svc" />{{ t('Service, via HTTPS') }}</span><span><i class="k-app" />{{ t('Application, installed') }}</span><span><i class="k-dir" />{{ t('Folder or file') }}</span><span><i class="k-key" />{{ t('Secret') }}</span>
          </div>
        </div>
        <AutomationsList v-if="mode === 'list'" :view="view" :group="group" :layers="layers" :now="now" @open="detail = $event" />
        <div v-else class="automations-live">
          <AutomationsMap :view="view" :group="group" :layers="layers" :pinned="pinned" :playing="playing" :now="now" @hover="hovered = $event" @pin="pinned = $event" @open="detail = $event" />
          <AutomationInfo :id="hovered ?? pinned" :view="view" :pinned="!!pinned && !hovered" :now="now" @open="detail = $event" />
        </div>
      </template>
    </section>
    <section v-else role="tabpanel">
      <p v-if="!view" class="muted" role="status">
        {{ t('Loading workspace…') }}
      </p>
      <DecisionsInbox v-else ref="inboxView" :view="view" :choices="inbox?.choices ?? []" :gates="inbox?.gates ?? []" :graph-gates="inbox?.graphGates ?? null" :requests="secrets?.requests ?? []" :secrets-origin="secrets?.origin" :desktop="!!desktop" @secrets="emit('secrets', $event)" @network="(command, settle) => emit('networkCommand', command, settle)" @workflow="emit('workflowCommand', $event)" @command="emit('command', $event)" />
    </section>
    <AppSettingsMenu v-if="settings" :browser="!desktop" :subject="subject" :consumer="secrets?.consumer ?? null" :sharing="!!sharing" @revoke="emit('secrets', { type: 'revokeConsumer' })" @advanced="emit('advanced')" @import="emit('import')" @close="settings = false" @logout="emit('logout')" @keydown.escape="settings = false" />
    <AutomationDetail v-if="view && detail" :id="detail" :key="detail" :view="view" :now="now" :desktop="!!desktop" :requests="secrets?.requests ?? []" :sharing="!!sharing" @editor="emit('openPod', $event)" @share="emit('share', $event)" @close="detail = null; secretForm = null" @open="(id) => { detail = id; pinned = id }" @command="emit('command', $event)" @network="emit('network', $event)" @workflow="emit('workflow', $event)" @secret="(podId, alias) => { secretForm = { podId, alias } }" @folder="emit('folder', $event)">
      <template #secret>
        <SecretForm v-if="secretForm && secretForm.podId === detail" :key="secretForm.alias ?? ''" :pod-id="secretForm.podId" :alias="secretForm.alias" :desktop="!!desktop" @save="(podId, alias, value) => { secretForm = null; emit('secretSave', podId, alias, value) }" @file="(podId, alias) => { secretForm = null; emit('secrets', { type: 'importFile', podId, alias }) }" @request="(podId, alias, purpose) => { secretForm = null; emit('secrets', { type: 'request', podId, alias, purpose }) }" @cancel="secretForm = null" />
      </template>
    </AutomationDetail>
  </div>
</template>

<style>
.automations-shell{min-width:0}
.automations-top{display:flex;flex-wrap:wrap;align-items:center;gap:8px 20px;padding:10px 0;border-bottom:1px solid var(--border);margin-bottom:12px;position:sticky;top:0;background:var(--bg);z-index:5}
.automations-top nav{display:flex;gap:4px;flex-wrap:wrap}
.automations-top nav button{font-weight:500;border:1px solid transparent;border-radius:6px;color:var(--muted);padding:6px 12px}
.automations-top nav button[aria-selected="true"]{background:var(--surface);border-color:var(--border);color:var(--text)}
.automations-top .n{display:inline-block;min-width:20px;padding:0 6px;border-radius:10px;background:var(--warn-soft);color:var(--warn);font-size:12px;font-weight:600;margin-left:6px;font-variant-numeric:tabular-nums}
.automations-top .gear{margin-left:auto;font-size:13px;border:1px solid var(--border);background:var(--surface);color:var(--muted);border-radius:6px;padding:5px 10px}
.automations-toolbar{display:flex;flex-wrap:wrap;gap:8px 16px;align-items:center;justify-content:space-between;margin:10px 0}
.automations-toolbar .tb-left,.automations-toolbar .tb-right{display:flex;flex-wrap:wrap;gap:8px;align-items:center}
.automations-toolbar .seg{display:inline-flex;flex-wrap:wrap;gap:2px;border:1px solid var(--border);border-radius:8px;padding:2px;background:var(--surface)}
.automations-toolbar .seg button{font-size:13px;font-weight:500;color:var(--muted);border-radius:6px;padding:4px 10px}
.automations-toolbar .seg button[aria-pressed="true"]{background:var(--tint);color:var(--accent);font-weight:600}
.automations-toolbar .layers{display:inline-flex;flex-wrap:wrap;gap:4px;border:1px solid var(--border);border-radius:8px;padding:2px;background:var(--surface)}
.automations-toolbar .lay{font-size:13px;color:var(--muted);border-radius:6px;padding:4px 10px 4px 8px;display:inline-flex;align-items:center;gap:6px}
.automations-toolbar .lay i{display:inline-block;width:10px;height:10px;border-radius:50%;opacity:.35}.automations-toolbar .lay i.dash{border-radius:2px;height:4px}
.automations-toolbar .lay[aria-pressed="true"]{color:var(--text);background:var(--tint)}.automations-toolbar .lay[aria-pressed="true"] i{opacity:1}
.automations-toolbar .idp{border-color:var(--idp);background:var(--idp-soft);color:var(--idp);font-weight:600}
.automations-toolbar .secondary{padding:6px 12px;font-size:14px}
.automations-kindrow{display:flex;flex-wrap:wrap;justify-content:space-between;gap:6px 16px;align-items:center;margin:0 0 8px}
.automations-stamp{font-size:12px;color:var(--muted)}.automations-stamp.live{color:var(--ok)}
.automations-kindrow .kinds{display:flex;flex-wrap:wrap;gap:4px 14px;font-size:12px;color:var(--muted)}
.automations-kindrow .kinds i{display:inline-block;width:14px;height:10px;border:1.4px solid;vertical-align:-1px;margin-right:5px}
.automations-kindrow .k-svc{border-color:var(--service);border-radius:6px}.automations-kindrow .k-app{border-color:var(--application);border-radius:2px}.automations-kindrow .k-dir{border-color:var(--warn);border-radius:1px 3px 3px 3px}.automations-kindrow .k-key{border:0;width:10px;height:10px;border-radius:50%;background:var(--warn)}
.automations-live{display:grid;grid-template-columns:minmax(0,1fr) 300px;gap:12px;align-items:start}
@media (max-width:1000px){.automations-live{grid-template-columns:1fr}}
</style>
