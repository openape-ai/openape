<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { MapView } from '../../contracts/map-view'
import { language, t } from '../i18n'
import { clock } from '../utils/cadence'
import AutomationDetail from './AutomationDetail.vue'
import AutomationInfo from './AutomationInfo.vue'
import DecisionsInbox from './DecisionsInbox.vue'
import type { DomainCommand, DomainOverview } from '../../contracts/domain-admin'
import type { CentralCommand } from '../../contracts/central'
import AutomationsList from './AutomationsList.vue'
import AutomationsMap from './AutomationsMap.vue'
import CodexHandoff from './CodexHandoff.vue'
import KpiRow from './KpiRow.vue'
import SecretForm from './SecretForm.vue'
import type { SecretsCommand, SecretsView } from '../../contracts/secrets'
import type { PortableSourceSelection } from '../../contracts/sharing'
import type { Layers } from '../utils/automation-layout'
import { allTags, tagCounts, untagged, withTags } from '../utils/tags'

/**
 * The two product surfaces behind one tab bar: Automatisierungen (this file) and Entscheidungen
 * (the `decisions` slot). The gear opens the one settings page of the host; creation hands a brief to Codex.
 */
const props = defineProps<{ view: MapView | null, live: boolean, now: number, decisions?: number, tab?: 'automations' | 'decisions', desktop?: boolean, codex?: 'connected' | 'disconnected', domain?: DomainOverview | null, inboxUrl?: string, secrets?: SecretsView | null, sharing?: boolean }>()
const emit = defineEmits<{ 'update:tab': [tab: 'automations' | 'decisions'], 'settings': [], 'codex': [pinned: string | null, tags: string[]], 'command': [command: CentralCommand], 'secretSave': [podId: string, alias: string, value: string], 'secrets': [command: SecretsCommand], 'folder': [podId: string], 'openPod': [id: string], 'share': [selection: PortableSourceSelection], 'domain': [command: DomainCommand, settle?: (error: string | null) => void] }>()
const layers = ref<Layers>({ data: true, read: true, write: true, auth: true, paused: true })
const playing = ref(true)
const pinned = ref<string | null>(null)
const hovered = ref<string | null>(null)
const detail = ref<string | null>(null)
const handoff = ref(false)
const secretForm = ref<{ podId: string, alias: string | null } | null>(null)
const inboxView = ref<InstanceType<typeof DecisionsInbox> | null>(null)
const waiting = computed(() => props.decisions ?? inboxView.value?.total ?? 0)
const current = computed(() => props.tab ?? 'automations')
// The tag selection is a per-device preference; private windows or blocked storage start without one.
const tagKey = 'pods.automations.tags'
function storedTags(): string[] {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(tagKey) ?? '[]')
    return Array.isArray(stored) ? stored.filter((item): item is string => typeof item === 'string') : []
  }
  catch { return [] }
}
const selected = ref<string[]>(storedTags())
// Pods without a tag stay visible until the owner deselects them, so a new Pod never hides behind a filter.
const untaggedKey = 'pods.automations.untagged-off'
const modeKey = 'pods.automations.mode'
function stored(key: string): string | null {
  try { return localStorage.getItem(key) }
  catch { return null }
}
function store(key: string, value: string) {
  try { localStorage.setItem(key, value) }
  catch {}
}
const untaggedOff = ref(stored(untaggedKey) === '1')
// Rows answer what each Pod does and how it is doing; the map shows connections and stays one click away.
const mode = ref<'map' | 'list'>(stored(modeKey) === 'map' ? 'map' : 'list')
watch(mode, value => store(modeKey, value))
const counts = computed(() => props.view ? tagCounts(props.view) : new Map<string, number>())
const tags = computed(() => props.view ? [...allTags(props.view), ...counts.value.has(untagged) ? [untagged] : []] : [])
// Without any tag in the workspace there is nothing to opt into, so everything stays visible.
const tagging = computed(() => tags.value.some(tag => tag !== untagged))
const active = computed(() => {
  const chosen = selected.value.filter(tag => tags.value.includes(tag))
  return tags.value.includes(untagged) && !untaggedOff.value && !chosen.includes(untagged) ? [...chosen, untagged] : chosen
})
const filtered = computed(() => props.view && tagging.value ? withTags(props.view, active.value) : props.view)
function selectTags(value: string[]) {
  selected.value = value; pinned.value = null; hovered.value = null
  untaggedOff.value = !value.includes(untagged)
  store(tagKey, JSON.stringify(value)); store(untaggedKey, untaggedOff.value ? '1' : '0')
}
function toggleTag(tag: string) { selectTags(active.value.includes(tag) ? active.value.filter(item => item !== tag) : [...active.value, tag]) }
const shownLayers = computed(() => Object.values(layers.value).filter(Boolean).length)
const layersMenu = ref<HTMLDetailsElement | null>(null)
function closeLayers() { if (layersMenu.value) layersMenu.value.open = false }
function closeLayersOutside(event: PointerEvent) { if (!layersMenu.value?.contains(event.target as Node)) closeLayers() }
onMounted(() => document.addEventListener('pointerdown', closeLayersOutside))
onBeforeUnmount(() => document.removeEventListener('pointerdown', closeLayersOutside))
const chips: { key: keyof Layers, label: string, color: string }[] = [{ key: 'data', label: 'Shared data', color: 'var(--accent)' }, { key: 'read', label: 'Read', color: 'var(--read)' }, { key: 'write', label: 'Write', color: 'var(--warn)' }, { key: 'auth', label: 'Approvals', color: 'var(--idp)' }, { key: 'paused', label: 'Paused', color: 'var(--muted)' }]
/** Codex labels the new automation like the pinned Pod. */
const pinnedTags = computed(() => props.view?.pods.find(pod => pod.id === pinned.value)?.tags?.own ?? [])
function openCodex() { handoff.value = true; emit('codex', pinned.value, pinnedTags.value) }
defineExpose({ pin: (id: string | null) => { pinned.value = id }, open: (id: string | null) => { detail.value = id }, mode, layers })
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
      <button class="gear" type="button" :title="t('Settings')" @click="emit('settings')">
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
          </div>
          <div class="tb-right">
            <details ref="layersMenu" class="layers-menu" @keydown.escape="closeLayers">
              <summary>{{ t('Layers') }} {{ shownLayers }}/{{ chips.length }}</summary>
              <div class="layers" role="group" :aria-label="t('Layers')">
                <button v-for="chip in chips" :key="chip.key" class="lay" :aria-pressed="layers[chip.key]" @click="layers[chip.key] = !layers[chip.key]">
                  <i :class="{ dash: chip.key === 'paused' }" :style="{ background: chip.color }" />{{ t(chip.label as 'Shared data') }}
                </button>
              </div>
            </details>
            <button v-if="mode === 'map'" class="secondary" type="button" :title="t(playing ? 'Pause animation' : 'Resume animation')" @click="playing = !playing">
              {{ playing ? '❚❚' : '▶' }}
            </button>
            <button class="secondary idp" type="button" @click="openCodex">
              {{ t('New automation with Codex') }}
            </button>
          </div>
        </div>
        <div v-if="tagging" class="automations-tags" role="group" :aria-label="t('Tags')">
          <button v-for="tag in tags" :key="tag" :aria-pressed="active.includes(tag)" @click="toggleTag(tag)">
            {{ tag === untagged ? t('Without tag') : `#${tag}` }} <span class="count">{{ counts.get(tag) ?? 0 }}</span>
          </button>
          <span class="quick">
            <button class="link" type="button" @click="selectTags(tags)">{{ t('All') }}</button> · <button class="link" type="button" @click="selectTags([])">{{ t('None') }}</button>
          </span>
        </div>
        <CodexHandoff v-if="handoff" :view="view" :pinned="pinned" :tags="pinnedTags" :connected="codex === undefined ? null : codex === 'connected'" @close="handoff = false" @settings="emit('settings')" />
        <div class="automations-kindrow">
          <span class="automations-stamp" :class="{ live }">{{ live ? t('Live · {time}', { time: clock(now, language) }) : t('As of {time}', { time: clock(view.at, language) }) }}</span>
          <details class="kinds-legend">
            <summary>{{ t('Legend') }}</summary>
            <div class="kinds">
              <span><i class="k-svc" />{{ t('Service, via HTTPS') }}</span><span><i class="k-app" />{{ t('Application, installed') }}</span><span><i class="k-dir" />{{ t('Folder or file') }}</span><span><i class="k-key" />{{ t('Secret') }}</span>
            </div>
          </details>
        </div>
        <p v-if="tagging && !active.length" class="automations-empty" role="status">
          {{ t('Activate tags to see their Pods ({count} Pods).', { count: view.pods.filter(pod => pod.lifecycle !== 'archived').length }) }}
        </p>
        <AutomationsList v-else-if="mode === 'list'" :view="filtered!" :layers="layers" :now="now" @open="detail = $event" />
        <div v-else class="automations-live">
          <AutomationsMap :view="filtered!" :layers="layers" :pinned="pinned" :playing="playing" :now="now" @hover="hovered = $event" @pin="pinned = $event" @open="detail = $event" />
          <AutomationInfo :id="hovered ?? pinned" :view="view" :pinned="!!pinned && !hovered" :now="now" @open="detail = $event" />
        </div>
      </template>
    </section>
    <section v-else role="tabpanel">
      <p v-if="!view" class="muted" role="status">
        {{ t('Loading workspace…') }}
      </p>
      <DecisionsInbox v-else ref="inboxView" :view="view" :domain="domain ?? null" :inbox-url="inboxUrl" :requests="secrets?.requests ?? []" :secrets-origin="secrets?.origin" :desktop="!!desktop" @secrets="emit('secrets', $event)" @domain="(command, settle) => emit('domain', command, settle)" @command="emit('command', $event)" />
    </section>
    <AutomationDetail v-if="view && detail" :id="detail" :key="detail" :view="view" :now="now" :desktop="!!desktop" :requests="secrets?.requests ?? []" :sharing="!!sharing" @editor="emit('openPod', $event)" @share="emit('share', $event)" @close="detail = null; secretForm = null" @open="(id) => { detail = id; pinned = id }" @command="emit('command', $event)" @secret="(podId, alias) => { secretForm = { podId, alias } }" @folder="emit('folder', $event)">
      <template #secret>
        <SecretForm v-if="secretForm && secretForm.podId === detail" :key="secretForm.alias ?? ''" :pod-id="secretForm.podId" :alias="secretForm.alias" :desktop="!!desktop" @save="(podId, alias, value) => { secretForm = null; emit('secretSave', podId, alias, value) }" @file="(podId, alias) => { secretForm = null; emit('secrets', { type: 'importFile', podId, alias }) }" @request="(podId, alias, purpose) => { secretForm = null; emit('secrets', { type: 'request', podId, alias, purpose }) }" @cancel="secretForm = null" />
      </template>
    </AutomationDetail>
  </div>
</template>

<style>
.automations-shell{min-width:0}
.automations-top{display:flex;flex-wrap:wrap;align-items:center;gap:8px 20px;padding:10px 0;border-bottom:1px solid var(--border);margin-bottom:12px;position:sticky;top:0;background:var(--bg);z-index:5;box-shadow:0 -16px 0 var(--bg)}
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
.automations-toolbar .layers-menu{position:relative}
.automations-toolbar .layers-menu summary,.kinds-legend summary{list-style:none;color:var(--muted)}
.automations-toolbar .layers-menu summary::-webkit-details-marker,.kinds-legend summary::-webkit-details-marker{display:none}
.automations-toolbar .layers-menu summary{font-size:13px;border:1px solid var(--border);border-radius:8px;padding:5px 10px;background:var(--surface)}
.automations-toolbar .layers-menu[open] summary{color:var(--text)}
.automations-toolbar .layers-menu .layers{position:absolute;right:0;top:calc(100% + 4px);z-index:6;flex-direction:column;align-items:stretch;min-width:160px;box-shadow:0 6px 20px rgb(0 0 0 / .12)}
.automations-tags{display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin:0 0 10px}
.automations-tags>button{font-size:13px;border:1px solid var(--border);border-radius:999px;padding:3px 10px;color:var(--muted);background:var(--surface)}
.automations-tags>button[aria-pressed="true"]{background:var(--tint);border-color:var(--accent);color:var(--accent);font-weight:600}
.automations-tags .count{font-variant-numeric:tabular-nums;opacity:.7;margin-left:2px}
.automations-tags .quick{font-size:12px;color:var(--muted);margin-left:4px}
.automations-tags .link{font-size:12px;color:var(--accent);padding:0;border:0;background:none}
.kinds-legend summary{font-size:12px;text-align:right}
.kinds-legend[open] .kinds{margin-top:4px}
.automations-empty{padding:48px 16px;text-align:center;color:var(--muted);border:1px dashed var(--border);border-radius:8px}
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
