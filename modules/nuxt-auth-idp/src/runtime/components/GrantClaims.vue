<script setup lang="ts">
import { computed } from 'vue'
import type { OpenApeGrantRequest } from '@openape/core'
import { grantSummaryView } from '../utils/grant-summary'

// `withoutTitle`: the card already leads with the summary title (`requesterHeadline`).
const props = defineProps<{ request: OpenApeGrantRequest, german: boolean, withoutTitle?: boolean }>()

const summary = computed(() => grantSummaryView(props.request.summary))
// The Pods desktop sends its display text both as reason and as title.
const reason = computed(() => {
  const value = props.request.reason?.trim()
  return value && value !== summary.value?.title ? value : null
})
const shown = computed(() => {
  const view = summary.value
  if (!view) return null
  return props.withoutTitle && !view.description && !view.origin && !view.link ? null : view
})
</script>

<template>
  <section v-if="shown || reason" class="rounded border border-default bg-elevated/50 px-3 py-2 space-y-1" data-requester-claims>
    <p class="text-xs text-muted">
      {{ german ? 'Angabe des Antragstellers' : 'Requester\'s statement' }}
    </p>
    <template v-if="shown">
      <p v-if="!withoutTitle" class="text-sm font-medium break-words">
        {{ shown.title }}
      </p>
      <p v-if="shown.description" class="text-sm whitespace-pre-wrap break-words">
        {{ shown.description }}
      </p>
      <p v-if="shown.origin" class="text-xs text-muted break-words">
        {{ german ? 'Herkunft' : 'Origin' }}: {{ shown.origin }}
      </p>
      <a v-if="shown.link" :href="shown.link" target="_blank" rel="noopener noreferrer" class="block text-sm text-primary underline break-all">{{ shown.link }}</a>
    </template>
    <p v-if="reason" class="text-sm break-words">
      <span class="text-muted">{{ german ? 'Begründung' : 'Reason' }}:</span> {{ reason }}
    </p>
  </section>
</template>
