<script setup lang="ts">
import type { LibraryItem } from '../../shared/library'
import { computed } from 'vue'
import { accessInfo, AUTHOR_LABEL, capitalize, daysLeft, days, KIND_LABEL, kindOf, shortDate } from '../utils/report-format'
import AppIcon from './AppIcon.vue'

const props = defineProps<{ item: LibraryItem, teamName: string | null }>()
const kind = computed(() => kindOf(props.item.category))
const access = computed(() => accessInfo(props.item.audience, props.teamName))
const tagLine = computed(() => props.item.tags.slice(0, 3).join(', ') + (props.item.tags.length > 3 ? ` +${props.item.tags.length - 3}` : ''))
const result = computed(() => props.item.test_result)
</script>

<template>
  <NuxtLink class="row" :to="item.href">
    <span class="kind" :class="kind" :title="KIND_LABEL[kind]"><AppIcon :name="kind" /><span class="sr">{{ KIND_LABEL[kind] }}:</span></span>
    <span class="main">
      <span class="row-title" :title="item.title">{{ item.title }}</span>
      <span class="row-sub">
        <span v-if="result && result.failed" class="state bad">{{ result.failed }} failed</span>
        <span v-else-if="result && result.status === 'passed'" class="state ok">All {{ result.passed }} passed</span>
        <span v-else-if="item.plan_status" class="state" :class="item.plan_status === 'active' ? 'plan' : 'neutral'">{{ capitalize(item.plan_status) }}</span>
        <span v-if="tagLine">{{ tagLine }}</span>
        <span v-if="item.expires_at" class="warn-text">Expires in {{ days(daysLeft(item.expires_at)) }}</span>
        <span class="m-only">{{ item.author }}, {{ shortDate(item.at) }}</span>
      </span>
    </span>
    <span class="cell c-pub" :title="item.author_type ? AUTHOR_LABEL[item.author_type] : undefined">
      <AppIcon v-if="item.author_type" :name="item.author_type" small /><span>{{ item.author }}<span v-if="item.author_type" class="sr"> ({{ AUTHOR_LABEL[item.author_type] }})</span></span>
    </span>
    <span class="cell c-access"><AppIcon :name="access.icon" small /><span>{{ access.short }}</span></span>
    <span class="date">{{ shortDate(item.at) }}</span>
  </NuxtLink>
</template>

<style scoped>
.row { display: grid; grid-template-columns: 28px minmax(0, 1fr) 170px 150px 96px; gap: 14px; align-items: center; padding: 13px 18px; text-decoration: none; border-bottom: 1px solid var(--rule); }
.row:hover { background: var(--paper-2); }
.row:hover .row-title { text-decoration: underline; text-underline-offset: 3px; }
.row:focus-visible { outline-offset: -3px; }
.main { min-width: 0; }
.cell { display: flex; align-items: center; gap: 7px; font-size: 13.5px; color: var(--ink-2); min-width: 0; }
.cell span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cell .i { color: var(--muted); }
.date { font-size: 13.5px; color: var(--muted); text-align: right; white-space: nowrap; }
.m-only { display: none; }
@media (max-width: 1100px) {
  .row { grid-template-columns: 28px minmax(0, 1fr) 150px 92px; }
  .c-access { display: none; }
}
@media (max-width: 760px) {
  .row { grid-template-columns: 28px minmax(0, 1fr); padding: 12px 14px; gap: 12px; align-items: start; }
  .c-pub, .c-access, .date { display: none; }
  .m-only { display: inline; }
}
</style>
