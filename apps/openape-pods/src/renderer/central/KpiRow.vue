<script setup lang="ts">
import { computed } from 'vue'
import type { MapView } from '../../contracts/map-view'
import { diagnostic, t } from '../i18n'
import { kpiFacts } from '../utils/kpis'

const props = defineProps<{ view: MapView }>()
const facts = computed(() => kpiFacts(props.view))
const pausedDetail = computed(() => {
  const { networks, drafts, archived } = facts.value.paused
  const parts = [networks ? t('{count} networks', { count: networks }) : '', drafts ? t('{count} drafts', { count: drafts }) : '', archived ? t('{count} archived', { count: archived }) : ''].filter(Boolean)
  return parts.length ? t('of which {parts}', { parts: parts.join(', ') }) : t('nothing paused')
})
const degradedDetail = computed(() => facts.value.degraded.name ? `${facts.value.degraded.name} · ${diagnostic(facts.value.degraded.reason)}` : t('nothing degraded'))
const decisionDetail = computed(() => facts.value.decisions.gates.length ? facts.value.decisions.gates.map(gate => gate.group ? `${gate.title} · ${gate.group}` : gate.title).join(', ') : t('nothing waiting'))
</script>

<template>
  <div class="kpi-row" role="list">
    <div class="kpi" role="listitem">
      <b>{{ facts.active }}</b><span>{{ t('active') }}</span><small>{{ t('Pods, chains and networks with a running schedule') }}</small>
    </div>
    <div class="kpi" role="listitem">
      <b>{{ facts.paused.total }}</b><span>{{ t('paused') }}</span><small>{{ pausedDetail }}</small>
    </div>
    <div class="kpi" :class="{ alert: facts.degraded.count }" role="listitem">
      <b>{{ facts.degraded.count }}</b><span>{{ t('degraded') }}</span><small>{{ degradedDetail }}</small>
    </div>
    <div class="kpi" role="listitem">
      <b>{{ facts.decisions.count }}</b><span>{{ t('decisions waiting for you') }}</span><small>{{ decisionDetail }}</small>
    </div>
    <div class="kpi" role="listitem">
      <b>{{ facts.unknownDeliveries }}</b><span>{{ t('unknown deliveries') }}</span><small>{{ facts.unknownDeliveries ? t('{count} deliveries to reconcile', { count: facts.unknownDeliveries }) : t('nothing to reconcile') }}</small>
    </div>
  </div>
</template>

<style>
.kpi-row{display:flex;flex-wrap:wrap;gap:10px;margin:0 0 8px}
.kpi{background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:10px 14px;min-width:150px;flex:1 1 150px;min-width:0}
.kpi b{display:block;font-size:22px;font-variant-numeric:tabular-nums;line-height:1.1}
.kpi span{font-size:12px;color:var(--muted)}
.kpi small{display:block;font-size:11px;color:var(--muted);opacity:.8;margin-top:2px;overflow-wrap:anywhere}
.kpi.alert{border-color:var(--bad)}.kpi.alert b{color:var(--bad)}
</style>
