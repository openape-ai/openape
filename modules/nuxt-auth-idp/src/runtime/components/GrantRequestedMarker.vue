<script setup lang="ts">
import { requestedMarker } from '../utils/grant-card'

defineProps<{ german: boolean }>()
</script>

<template>
  <span class="ml-1 inline-block rounded border border-warning/50 px-1 align-middle text-xs font-normal text-warning" data-requested-marker>{{ requestedMarker(german ? 'de' : 'en') }}</span>
</template>
