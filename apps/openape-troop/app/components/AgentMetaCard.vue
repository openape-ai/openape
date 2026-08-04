<script setup lang="ts">
import type { Agent } from '../types/agent'

// Agent metadata. Collapsed by default on mobile because the SSH key + email
// are long strings that crowd out the tasks section, which is what the user
// actually came here to edit.
defineProps<{ agent: Agent }>()

const { fmtDate } = useDateFormat()
const { fmtRelative } = useRelativeTime()
</script>

<template>
  <UCard :ui="{ body: 'p-0' }">
    <details class="group">
      <summary class="cursor-pointer list-none px-4 py-3 flex items-center justify-between gap-2">
        <div class="flex items-center gap-2 text-sm">
          <UIcon name="i-lucide-info" class="text-muted size-4" />
          <span class="font-medium">{{ $t('agentDetail.details.title') }}</span>
          <span class="text-xs text-muted">·</span>
          <span class="text-xs text-muted">{{ $t('agentDetail.details.lastSyncShort', { value: fmtRelative(agent.lastSeenAt) }) }}</span>
        </div>
        <UIcon name="i-lucide-chevron-down" class="size-4 text-muted transition-transform group-open:rotate-180" />
      </summary>
      <dl class="px-4 pb-4 pt-1 space-y-3 text-sm border-t border-(--ui-border)">
        <div>
          <dt class="text-xs text-muted mb-0.5">
            {{ $t('agentDetail.details.email') }}
          </dt>
          <dd class="font-mono text-xs break-all">
            {{ agent.email }}
          </dd>
        </div>
        <div>
          <dt class="text-xs text-muted mb-0.5">
            {{ $t('agentDetail.details.hostname') }}
          </dt>
          <dd class="font-mono">
            {{ agent.hostname || '—' }}
          </dd>
        </div>
        <div>
          <dt class="text-xs text-muted mb-0.5">
            {{ $t('agentDetail.details.hostId') }}
          </dt>
          <dd class="font-mono text-xs break-all">
            {{ agent.hostId || '—' }}
          </dd>
        </div>
        <div>
          <dt class="text-xs text-muted mb-0.5">
            {{ $t('agentDetail.details.pubkey') }}
          </dt>
          <dd class="font-mono text-xs break-all">
            {{ agent.pubkeySsh || '—' }}
          </dd>
        </div>
        <div class="grid grid-cols-2 gap-3">
          <div>
            <dt class="text-xs text-muted mb-0.5">
              {{ $t('agentDetail.details.firstSync') }}
            </dt>
            <dd class="text-sm">
              {{ fmtDate(agent.firstSeenAt) }}
            </dd>
          </div>
          <div>
            <dt class="text-xs text-muted mb-0.5">
              {{ $t('agentDetail.details.lastSync') }}
            </dt>
            <dd class="text-sm">
              {{ fmtDate(agent.lastSeenAt) }}
            </dd>
          </div>
        </div>
      </dl>
    </details>
  </UCard>
</template>
