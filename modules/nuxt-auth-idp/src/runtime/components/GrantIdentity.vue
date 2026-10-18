<script setup lang="ts">
import { computed } from 'vue'
import type { GrantWithCard } from '../utils/grant-card'

const props = defineProps<{ grant: GrantWithCard, german: boolean }>()
const requester = computed(() => props.grant.card?.requester)
const name = computed(() => requester.value?.name || (props.german ? 'Nicht registrierter Antragsteller' : 'Unregistered requester'))
</script>

<template>
  <div class="min-w-0 border-t border-default pt-3 text-sm" data-requester-identity>
    <p class="font-medium break-words">
      {{ name }}
    </p>
    <p class="text-xs text-muted break-all">
      {{ grant.request.requester }}
    </p>
    <p v-if="requester?.owner" class="mt-1 text-xs text-muted break-all">
      Owner: {{ requester.owner }}
    </p>
    <p v-if="grant.request.submitted_by" class="mt-1 text-xs text-muted break-all">
      {{ german ? 'Eingereicht über Delegation von' : 'Submitted via delegation by' }} {{ grant.request.submitted_by.delegate }}
    </p>
  </div>
</template>
