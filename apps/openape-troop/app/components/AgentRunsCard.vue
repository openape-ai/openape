<script setup lang="ts">
import type { Run } from '../types/agent'

// Recent task runs, newest first — status, elapsed time, final message and
// the raw trace behind a second disclosure.
defineProps<{ runs: Run[] }>()

const { fmtDate } = useDateFormat()

const statusColor: Record<Run['status'], string> = { running: 'info', ok: 'success', error: 'error' }
</script>

<template>
  <UCard :ui="{ body: 'p-0' }">
    <details class="group">
      <summary class="cursor-pointer list-none px-4 py-3 flex items-center justify-between gap-2">
        <div class="flex items-center gap-2 text-sm">
          <UIcon name="i-lucide-history" class="text-muted size-4" />
          <span class="font-medium">{{ $t('agentDetail.runs.title') }}</span>
          <UBadge color="neutral" variant="subtle" size="xs">
            {{ runs.length }}
          </UBadge>
        </div>
        <UIcon name="i-lucide-chevron-down" class="size-4 text-muted transition-transform group-open:rotate-180" />
      </summary>
      <div class="border-t border-(--ui-border)">
        <div v-if="runs.length === 0" class="px-4 py-6 text-center text-muted text-sm">
          {{ $t('agentDetail.runs.empty') }}
        </div>
        <ul v-else class="divide-y divide-(--ui-border)">
          <li v-for="r in runs" :key="r.id" class="px-4 py-3">
            <div class="flex items-start justify-between gap-3">
              <div class="flex-1 min-w-0">
                <div class="flex items-center gap-2">
                  <UBadge :color="(statusColor[r.status] as any)" variant="subtle" size="xs">
                    {{ $t(`agentDetail.runs.status.${r.status}`) }}
                  </UBadge>
                  <code class="font-mono text-xs">{{ r.taskId }}</code>
                  <span class="text-xs text-muted">
                    {{ fmtDate(r.startedAt) }}
                    <span v-if="r.finishedAt"> · {{ $t('agentDetail.runs.elapsedSec', { n: (r.finishedAt - r.startedAt).toFixed(0) }) }}</span>
                  </span>
                </div>
                <p v-if="r.finalMessage" class="text-sm mt-1 break-words">
                  {{ r.finalMessage }}
                </p>
                <details v-if="r.trace" class="mt-1">
                  <summary class="cursor-pointer text-xs text-muted">
                    {{ $t('agentDetail.runs.trace') }}
                  </summary>
                  <pre class="text-xs mt-1 p-2 bg-(--ui-bg-elevated) rounded overflow-auto max-h-72">{{ JSON.stringify(r.trace, null, 2) }}</pre>
                </details>
              </div>
            </div>
          </li>
        </ul>
      </div>
    </details>
  </UCard>
</template>
