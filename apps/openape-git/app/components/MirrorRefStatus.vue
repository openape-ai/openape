<script setup lang="ts">
defineProps<{
  url?: string
  state: { ref: string, sourceSha: string | null, targetSha: string | null, checkedAt: number, syncedAt: number | null, error: string | null }
}>()
</script>

<template>
  <li class="border border-zinc-800 rounded p-3 break-all">
    <p class="font-mono">
      {{ state.ref }} · {{ url }}
    </p>
    <p>Source: {{ state.sourceSha ?? 'deleted' }} · Target: {{ state.targetSha ?? 'absent or unavailable' }}</p>
    <p>Checked: {{ new Date(state.checkedAt * 1000).toLocaleString() }} · Last synchronized: {{ state.syncedAt ? new Date(state.syncedAt * 1000).toLocaleString() : 'never' }}</p>
    <p :class="state.error ? 'text-red-400' : 'text-emerald-500'">
      {{ state.error ?? 'Synchronized' }}
    </p>
  </li>
</template>
