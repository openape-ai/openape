<script setup lang="ts">
import { computed } from 'vue'

interface Member {
  agentEmail: string
  agentName: string
  role: string
  status: string
  spawnIntentId?: string | null
  spawnStatus?: string | null
  spawnError?: string | null
}

const props = defineProps<{
  member: Member
  /** Visible role label (already localized — caller passes $t output). */
  roleLabel: string
  /** Tailwind color classes for the card surface. */
  colorClass: string
  /** Size: 'lg' for CEO/Sanierer/Teamlead, 'sm' for Specialists. */
  size?: 'lg' | 'sm'
  /** Optional fine-print under the badge (e.g. Sanierer reporting note). */
  note?: string
}>()

const emit = defineEmits<{ linkAgent: [email: string], spawnAgent: [email: string] }>()

const { t } = useI18n()

function isPlaceholderEmail(email: string): boolean {
  return /^pending\+[a-f0-9]{8}@org\.openape\.ai$/i.test(email)
}

const isPlaceholder = computed(() => isPlaceholderEmail(props.member.agentEmail))
const isSpawning = computed(() => props.member.spawnStatus === 'pending')
const spawnFailed = computed(() => props.member.spawnStatus === 'failed')

const isLg = computed(() => (props.size ?? 'lg') === 'lg')

const statusBadge = computed(() => {
  if (props.member.status === 'active') return { color: 'success' as const, label: t('chart.status.active') }
  if (props.member.status === 'invited') return { color: 'warning' as const, label: t('chart.status.invited') }
  return { color: 'neutral' as const, label: props.member.status }
})
</script>

<template>
  <div
    class="rounded-lg border text-center relative"
    :class="[
      colorClass,
      isLg ? 'px-4 py-3 min-w-[180px]' : 'px-3 py-2',
      { 'border-dashed': isPlaceholder && !isSpawning, 'opacity-90': isSpawning },
    ]"
  >
    <div
      class="uppercase tracking-wide font-semibold"
      :class="isLg ? 'text-xs' : 'text-[10px] opacity-70'"
    >
      {{ roleLabel }}
    </div>
    <div
      class="font-mono break-all"
      :class="isLg ? 'text-sm mt-1' : 'text-xs mt-0.5'"
    >
      {{ member.agentName }}
    </div>
    <UBadge
      :color="statusBadge.color"
      variant="subtle"
      size="xs"
      :class="isLg ? 'mt-2' : 'mt-1.5'"
    >
      {{ statusBadge.label }}
    </UBadge>
    <div v-if="note" class="text-[10px] text-muted mt-1">
      {{ note }}
    </div>

    <!-- Spawn-in-flight state: replaces the action buttons with a
         spinner + status text. The parent page is responsible for the
         actual polling and re-renders this card as soon as
         spawn_status flips. -->
    <div
      v-if="isSpawning"
      class="mt-2 flex items-center justify-center gap-1.5 text-[10px] text-amber-300"
    >
      <UIcon name="i-lucide-loader-circle" class="animate-spin size-3" />
      <span>{{ $t('chart.spawning') }}</span>
    </div>

    <!-- Spawn failure: short error + retry hint. Click "Spawn agent"
         again to retry; spawn_error is cleared on next POST. -->
    <div v-else-if="spawnFailed" class="mt-2 space-y-1">
      <div class="text-[10px] text-red-400 line-clamp-2" :title="member.spawnError ?? undefined">
        {{ member.spawnError ?? $t('chart.spawnFailedGeneric') }}
      </div>
      <button type="button" class="block w-full text-[10px] underline text-amber-300/80 cursor-pointer" @click="emit('spawnAgent', member.agentEmail)">
        {{ $t('chart.spawnRetry') }}
      </button>
    </div>

    <!-- Placeholder, no spawn in flight, no failure: primary "Spawn
         agent" auto-flow (cross-SP DDISA delegation per
         openape-ai/protocol sp-data-access.md) + secondary "Link
         existing" manual-paste path for agents already created in
         troop by hand. -->
    <template v-else-if="isPlaceholder">
      <button type="button" class="block w-full mt-2 text-[10px] font-semibold uppercase tracking-wide text-amber-300 hover:text-amber-200 cursor-pointer" @click="emit('spawnAgent', member.agentEmail)">
        {{ $t('chart.spawnCta') }}
      </button>
      <button type="button" class="block w-full mt-0.5 text-[10px] underline text-amber-300/70 cursor-pointer" @click="emit('linkAgent', member.agentEmail)">
        {{ $t('chart.linkAgentCta') }}
      </button>
    </template>
  </div>
</template>
