<script setup lang="ts">
import { computed } from 'vue'
import type { MapView } from '../../contracts/map-view'
import type { SecretRequestRow } from '../../contracts/secrets'
import { diagnostic, t } from '../i18n'
import { kpiFacts } from '../utils/kpis'

const props = defineProps<{ view: MapView, requests?: SecretRequestRow[] }>()
const facts = computed(() => kpiFacts(props.view, props.requests ?? []))
const pausedDetail = computed(() => {
  const { drafts, archived } = facts.value.paused
  const parts = [drafts ? t('{count} drafts', { count: drafts }) : '', archived ? t('{count} archived', { count: archived }) : ''].filter(Boolean)
  return parts.length ? t('of which {parts}', { parts: parts.join(', ') }) : t('nothing paused')
})
// The Pods with the most failed runs first; a Pod that is degraded without a failed run (gaps, a blocked queue) follows.
const errorDetail = computed(() => {
  const { failures, degraded } = facts.value
  const pods = failures.pods.slice(0, 2).map(pod => `${pod.name} ${pod.count}`)
  if (failures.pods.length > 2) pods.push(t('{count} more', { count: failures.pods.length - 2 }))
  const now = degraded.name && !failures.pods.some(pod => pod.name === degraded.name) ? [t('now: {name} · {reason}', { name: degraded.name, reason: diagnostic(degraded.reason) })] : []
  const parts = [...pods, ...now]
  return parts.length ? parts.join(', ') : t('no errors in 24 h')
})
const decisionDetail = computed(() => {
  const { questions, approvals, rights, reconcile, secrets } = facts.value.decisions
  const parts = [
    ...(questions ? [t('{count} questions', { count: questions })] : []),
    ...(approvals ? [t('{count} approvals', { count: approvals })] : []),
    ...(rights ? [t('{count} rights', { count: rights })] : []),
    ...(reconcile ? [t('{count} to reconcile', { count: reconcile })] : []),
    ...(secrets ? [t('{count} secret requests', { count: secrets })] : []),
  ]
  return parts.length ? parts.join(', ') : t('nothing waiting')
})
</script>

<template>
  <div class="kpi-row" role="list">
    <div class="kpi" role="listitem">
      <b>{{ facts.active }}</b><span>{{ t('active') }}</span><small>{{ t('Pods with a running schedule') }}</small>
    </div>
    <div class="kpi" role="listitem">
      <b>{{ facts.paused.total }}</b><span>{{ t('paused') }}</span><small>{{ pausedDetail }}</small>
    </div>
    <div class="kpi" :class="{ alert: facts.failures.runs || facts.degraded.count }" role="listitem" data-kpi="errors">
      <b>{{ facts.failures.runs }}</b><span>{{ t('errors in 24 h') }}</span><small>{{ errorDetail }}</small>
    </div>
    <div class="kpi" role="listitem" data-kpi="decisions">
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
