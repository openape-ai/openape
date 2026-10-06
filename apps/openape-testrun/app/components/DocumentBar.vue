<script setup lang="ts">
import type { AccessInfo, AuthorType, Kind } from '../utils/report-format'
import { computed } from 'vue'
import { AUTHOR_LABEL, daysLeft, days, KIND_LABEL, longDate, shortDate } from '../utils/report-format'
import AppIcon from './AppIcon.vue'

export type DetailsSection = 'sec-access' | 'sec-keep' | 'sec-tech' | undefined
const props = defineProps<{ title: string, kind: Kind, author: string, authorType: AuthorType, at: number, version: number, latestVersion: number, latestHref: string, expiresAt: number | null, access: AccessInfo }>()
const emit = defineEmits<{ details: [section: DetailsSection] }>()
// An expiry hint belongs in the bar only when it is close; the full date is always in Details.
const expiring = computed(() => props.expiresAt !== null && daysLeft(props.expiresAt) <= 14)
</script>

<template>
  <header class="docbar">
    <NuxtLink class="btn quiet icon" to="/reports" aria-label="Back to all reports" title="All reports">
      <AppIcon name="back" />
    </NuxtLink>
    <span class="kind hide-narrow" :class="kind" :title="KIND_LABEL[kind]"><AppIcon :name="kind" small /></span>
    <div class="doc-id">
      <h1 :title="title">
        {{ title }}
      </h1>
      <p class="byline">
        <span :title="authorType ? AUTHOR_LABEL[authorType] : undefined"><AppIcon v-if="authorType" :name="authorType" small />{{ author }}</span><span>{{ shortDate(at) }}</span>
      </p>
    </div>
    <NuxtLink v-if="version < latestVersion" class="pill warn" :to="latestHref" :title="`Version ${latestVersion} is newer`">
      <AppIcon name="history" small /><span>Version {{ version }} of {{ latestVersion }}<span class="hide-narrow">. Read latest</span></span>
    </NuxtLink>
    <button v-if="expiring" class="pill warn" type="button" :title="`Expires ${longDate(expiresAt!)}`" @click="emit('details', 'sec-keep')">
      <AppIcon name="clock" small /><span>{{ days(daysLeft(expiresAt!)) }} left</span>
    </button>
    <button class="pill" type="button" :title="`Who can open it: ${access.short}`" :aria-label="`Who can open it: ${access.short}`" @click="emit('details', 'sec-access')">
      <AppIcon :name="access.icon" small /><span class="hide-narrow">{{ access.short }}</span>
    </button>
    <button class="btn quiet icon" type="button" aria-label="Details, versions and download" title="Details" @click="emit('details', undefined)">
      <AppIcon name="panel" />
    </button>
  </header>
</template>

<style scoped>
.docbar { height: 48px; flex: none; display: flex; align-items: center; gap: 6px; padding: 0 8px; background: var(--mat); border-bottom: 1px solid var(--rule); }
.kind { width: 24px; height: 24px; border-radius: 6px; }
.doc-id { flex: 1; min-width: 0; display: flex; align-items: baseline; gap: 12px; }
h1 { font-size: 15px; font-weight: 650; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; margin: 0; }
.byline { display: flex; gap: 12px; font-size: 13px; color: var(--muted); white-space: nowrap; flex: none; margin: 0; }
.byline > span { display: inline-flex; align-items: center; gap: 5px; }
@media (max-width: 760px) {
  .hide-narrow, .byline { display: none; }
}
</style>
