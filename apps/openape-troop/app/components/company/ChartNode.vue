<script setup lang="ts">
import { computed } from 'vue'

// One node in the company hierarchy chart (B0 merge — preserves the org-chart
// hierarchy from the former openape-org app). Active agents are clickable into
// their chat (`/agents/<name>`, like everywhere in troop); the CEO node carries
// the prominent "talk to the CEO" affordance (the Owner's front door); invited
// placeholders show a spawn button.

interface Member { agentEmail: string, agentName: string, role: string, status: string, persona: string | null, reportsToEmail: string | null }

const props = defineProps<{
  member: Member
  roleLabel: string
  colorClass: string
  size?: 'lg' | 'sm'
  /** The CEO node — gets the prominent chat button. */
  primary?: boolean
  /** Non-empty while a spawn for this member is in flight. */
  spawningText?: string
}>()

defineEmits<{ spawn: [member: Member] }>()

const isLg = computed(() => (props.size ?? 'lg') === 'lg')
const isActive = computed(() => props.member.status === 'active')
const statusColor = computed(() => props.member.status === 'active' ? 'success' : props.member.status === 'invited' ? 'warning' : 'neutral')
const chatHref = computed(() => `/agents/${props.member.agentName}`)
</script>

<template>
  <div
    class="rounded-lg border text-center relative"
    :class="[colorClass, isLg ? 'px-4 py-3 min-w-[180px]' : 'px-3 py-2', { 'border-dashed': !isActive }]"
  >
    <div class="uppercase tracking-wide font-semibold" :class="isLg ? 'text-xs' : 'text-[10px] opacity-70'">
      {{ roleLabel }}
    </div>
    <div class="font-mono break-all" :class="isLg ? 'text-sm mt-1' : 'text-xs mt-0.5'">
      {{ member.agentName }}
    </div>
    <UBadge :color="statusColor" variant="subtle" size="xs" :class="isLg ? 'mt-2' : 'mt-1.5'">
      {{ member.status }}
    </UBadge>

    <!-- Spawn in flight -->
    <div v-if="spawningText" class="mt-2 flex items-center justify-center gap-1.5 text-[10px] text-amber-300">
      <UIcon name="i-lucide-loader-circle" class="animate-spin size-3" />
      <span>{{ spawningText }}</span>
    </div>

    <!-- CEO: prominent chat button -->
    <UButton
      v-else-if="primary && isActive"
      :to="chatHref"
      color="primary"
      size="sm"
      icon="i-lucide-message-circle"
      class="mt-3"
    >
      Mit dem CEO sprechen
    </UButton>

    <!-- Other active agent: understated chat link (CEO stays the front door) -->
    <UButton
      v-else-if="isActive"
      :to="chatHref"
      color="neutral"
      variant="ghost"
      size="xs"
      icon="i-lucide-message-circle"
      :class="isLg ? 'mt-2' : 'mt-1'"
    >
      chatten
    </UButton>

    <!-- Invited / placeholder with a persona: spawn -->
    <UButton
      v-else-if="member.persona"
      color="neutral"
      variant="soft"
      size="xs"
      icon="i-lucide-sparkles"
      :class="isLg ? 'mt-2' : 'mt-1'"
      @click="$emit('spawn', member)"
    >
      {{ primary ? 'CEO spawnen' : 'Spawnen' }}
    </UButton>
  </div>
</template>
