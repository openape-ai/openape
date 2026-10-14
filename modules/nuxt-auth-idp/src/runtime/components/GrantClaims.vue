<script setup lang="ts">
import { computed } from 'vue'
import type { OpenApeGrantRequest } from '@openape/core'
import { grantSummaryView } from '../utils/grant-summary'

const props = defineProps<{ request: OpenApeGrantRequest, german: boolean }>()

const summary = computed(() => grantSummaryView(props.request.summary))
// The Pods desktop sends its display text both as reason and as title.
const reason = computed(() => {
  const value = props.request.reason?.trim()
  return value && value !== summary.value?.title ? value : null
})
</script>

<template>
  <section v-if="summary || reason" class="rounded border border-default bg-elevated/50 px-3 py-2 space-y-1" data-requester-claims>
    <p class="text-xs text-muted">
      {{ german ? 'Angabe des Antragstellers' : 'Requester\'s statement' }}
    </p>
    <template v-if="summary">
      <p class="text-sm font-medium break-words">
        {{ summary.title }}
      </p>
      <p v-if="summary.description" class="text-sm whitespace-pre-wrap break-words">
        {{ summary.description }}
      </p>
      <p v-if="summary.origin" class="text-xs text-muted break-words">
        {{ german ? 'Herkunft' : 'Origin' }}: {{ summary.origin }}
      </p>
      <a v-if="summary.link" :href="summary.link" target="_blank" rel="noopener noreferrer" class="block text-sm text-primary underline break-all">{{ summary.link }}</a>
    </template>
    <p v-if="reason" class="text-sm break-words">
      <span class="text-muted">{{ german ? 'Begründung' : 'Reason' }}:</span> {{ reason }}
    </p>
  </section>
</template>
