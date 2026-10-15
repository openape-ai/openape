<script setup lang="ts">
import { computed } from 'vue'
import type { GrantBatchRow } from '../utils/grant-batch'
import GrantRequestedMarker from './GrantRequestedMarker.vue'

// One batch member: what its approval binds, its labeled claim and the link to
// its single approval view. The leading slot holds the checkbox or a badge;
// `status` labels a decided member above its line instead.
const props = defineProps<{ row: GrantBatchRow, german: boolean, inputId?: string, failure?: string, status?: string }>()

const detailsPath = computed(() => `/grant-approval?grant_id=${encodeURIComponent(props.row.id)}`)
const text = computed(() => props.german
  ? { own: 'Beschreibung des Anfragenden', quoted: (value: string) => `„${value}“`, details: 'Details', hidden: (n: number) => `+${n} weitere` }
  : { own: 'requester\'s description', quoted: (value: string) => `"${value}"`, details: 'Details', hidden: (n: number) => `+${n} more` })
</script>

<template>
  <li class="flex items-start gap-3 py-2" :data-batch-row="row.id">
    <slot />
    <div class="min-w-0 flex-1">
      <!-- Floats beside the head, so the command's facts use the full row width below it. -->
      <a v-if="row.compact" :href="detailsPath" class="float-right ml-3 text-sm underline">{{ text.details }} →</a>
      <label :for="inputId" class="block text-sm break-words">
        <span v-if="status" class="mb-0.5 inline-block rounded border border-default px-1.5 text-xs text-muted" data-row-status>{{ status }}</span>
        <span v-if="row.compact" class="block" data-binding-line="command">
          <span class="block font-mono text-sm font-medium [overflow-wrap:anywhere]" data-command-head>{{ row.compact.head }}</span>
          <span class="mt-0.5 block text-xs leading-5">
            <template v-for="(fact, index) in row.compact.facts" :key="index"><span class="inline-block max-w-full rounded bg-elevated px-1 [overflow-wrap:anywhere]" data-command-fact><span v-if="fact.label" class="mr-1 text-muted">{{ fact.label }}</span>{{ fact.value }}</span>{{ ' ' }}</template>
            <span v-if="row.compact.hidden" class="text-muted whitespace-nowrap" data-command-hidden>{{ text.hidden(row.compact.hidden) }}</span>
          </span>
        </span>
        <span v-else :class="row.line.kind === 'registry' ? 'font-medium' : 'font-mono text-xs break-all'" :data-binding-line="row.line.kind">{{ row.line.text }}</span><GrantRequestedMarker v-if="row.line.requested" :german="german" />
        <span v-if="row.claim" class="block text-xs text-muted" data-row-claim>{{ text.own }}: {{ text.quoted(row.claim) }}</span>
        <span v-if="failure" class="block text-xs text-error">{{ failure }}</span>
      </label>
    </div>
    <a v-if="!row.compact" :href="detailsPath" class="shrink-0 text-sm underline">{{ text.details }} →</a>
  </li>
</template>
