<script setup lang="ts">
import { computed } from 'vue'
import type { MapView } from '../../contracts/map-view'
import type { SecretRequestRow } from '../../contracts/secrets'
import { label, t } from '../i18n'
import { kpiFacts } from '../utils/kpis'

const props = defineProps<{ view: MapView, requests?: SecretRequestRow[] }>()
const emit = defineEmits<{ open: [id: string] }>()
const facts = computed(() => kpiFacts(props.view, props.requests ?? []))
const shownErrors = computed(() => facts.value.errors.slice(0, 2))
const decisionDetail = computed(() => {
  const { questions, approvals, rights, work, secrets } = facts.value.decisions
  const parts = [
    ...(questions ? [t('{count} questions', { count: questions })] : []),
    ...(approvals ? [t('{count} approvals', { count: approvals })] : []),
    ...(rights ? [t('{count} rights', { count: rights })] : []),
    ...(work ? [t('{count} failed work items', { count: work })] : []),
    ...(secrets ? [t('{count} secret requests', { count: secrets })] : []),
  ]
  return parts.length ? parts.join(', ') : t('nothing waiting')
})
</script>

<template>
  <div class="kpi-row" role="list">
    <div class="kpi" role="listitem" data-kpi="active">
      <b>{{ facts.active.running }} / {{ facts.active.total }}</b><span>{{ t('active') }}</span><small>{{ t('Pods with a running schedule') }}</small>
    </div>
    <div class="kpi" :class="{ alert: facts.errors.length }" role="listitem" data-kpi="errors">
      <b>{{ facts.errors.length }}</b><span>{{ t('current errors') }}</span>
      <small v-if="!facts.errors.length">{{ t('no current errors') }}</small>
      <small v-else>
        <template v-for="(error, index) in shownErrors" :key="error.podId">{{ index ? ', ' : '' }}<button type="button" class="kpi-pod" @click="emit('open', error.podId)">{{ error.name }}</button>{{ facts.errors.length === 1 && error.reason ? ` · ${label(error.reason)}` : '' }}</template>{{ facts.errors.length > 2 ? `, ${t('{count} more', { count: facts.errors.length - 2 })}` : '' }}
      </small>
    </div>
    <div class="kpi" role="listitem" data-kpi="decisions">
      <b>{{ facts.decisions.count }}</b><span>{{ t('decisions waiting for you') }}</span><small>{{ decisionDetail }}</small>
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
.kpi-pod{all:unset;cursor:pointer;color:inherit;text-decoration:underline;text-underline-offset:2px}
.kpi-pod:focus-visible{outline:2px solid var(--accent);outline-offset:1px;border-radius:2px}
</style>
