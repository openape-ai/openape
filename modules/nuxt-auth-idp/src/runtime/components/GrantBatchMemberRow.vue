<script setup lang="ts">
import { computed } from 'vue'
import type { GrantBatchRow } from '../utils/grant-batch'
import GrantCard from './GrantCard.vue'

const props = defineProps<{ row: GrantBatchRow, german: boolean, inputId?: string, failure?: string, status?: string }>()
const detailsPath = computed(() => `/grant-approval?grant_id=${encodeURIComponent(props.row.id)}`)
</script>

<template>
  <li class="flex min-w-0 items-start gap-3 py-4" :data-batch-row="row.id">
    <slot />
    <div class="min-w-0 flex-1">
      <span v-if="status" class="mb-2 inline-block rounded border border-default px-1.5 text-xs text-muted" data-row-status>{{ status }}</span>
      <GrantCard :grant="row.grant" :german="german" compact :identity="false" :language-switch="false" />
      <p v-if="failure" class="mt-2 text-xs text-error" role="alert">
        {{ failure }}
      </p>
      <a :href="detailsPath" class="mt-2 inline-block text-xs underline">{{ german ? 'Einzeln prüfen' : 'Review individually' }} →</a>
    </div>
  </li>
</template>
