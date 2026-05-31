<script setup lang="ts">
import { computed } from 'vue'

interface Member {
  orgId: string
  agentEmail: string
  agentName: string
  role: string
  reportsToEmail: string | null
  status: string
  spawnedAt: number | null
  retiredAt: number | null
  createdAt: number
  spawnIntentId?: string | null
  spawnStatus?: string | null
  spawnError?: string | null
}

const props = defineProps<{ members: Member[], ownerEmail: string }>()

defineEmits<{
  retire: [email: string]
  linkAgent: [email: string]
  spawnAgent: [email: string]
}>()

const active = computed(() => props.members.filter(m => m.status !== 'retired'))

const ceo = computed(() => active.value.find(m => m.role === 'ceo') ?? null)
const sanierer = computed(() => active.value.find(m => m.role === 'sanierer') ?? null)
const teamleads = computed(() => active.value.filter(m => m.role === 'teamlead'))
function specialistsOf(teamleadEmail: string) {
  return active.value.filter(m => m.role === 'specialist' && m.reportsToEmail === teamleadEmail)
}
const unassignedSpecialists = computed(() =>
  active.value.filter(m => m.role === 'specialist' && (!m.reportsToEmail || !teamleads.value.some(tl => tl.agentEmail === m.reportsToEmail))),
)
const others = computed(() => active.value.filter(m => !['ceo', 'sanierer', 'teamlead', 'specialist'].includes(m.role)))

function roleColor(role: string): string {
  switch (role) {
    case 'ceo': return 'bg-amber-500/20 text-amber-300 border-amber-500/40'
    case 'sanierer': return 'bg-red-500/20 text-red-300 border-red-500/40'
    case 'teamlead': return 'bg-blue-500/20 text-blue-300 border-blue-500/40'
    case 'specialist': return 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
    default: return 'bg-zinc-500/20 text-zinc-300 border-zinc-500/40'
  }
}
</script>

<template>
  <div class="space-y-6">
    <!-- Owner card — root of the chart, not a member row. -->
    <div class="flex flex-col items-center gap-3">
      <div class="rounded-lg border border-amber-600/40 bg-amber-500/5 px-4 py-3 text-center min-w-[180px]">
        <div class="text-xs uppercase tracking-wide text-amber-400 font-semibold">
          {{ $t('chart.role.owner') }}
        </div>
        <div class="font-mono text-sm mt-1 break-all">
          {{ ownerEmail }}
        </div>
      </div>
    </div>

    <div v-if="active.length === 0" class="rounded-lg border border-dashed border-(--ui-border) p-8 text-center space-y-3">
      <div class="text-4xl">
        👔
      </div>
      <p class="text-muted text-sm">
        {{ $t('chart.empty.title') }}
      </p>
      <p class="text-xs text-muted max-w-md mx-auto">
        {{ $t('chart.empty.hint') }}
      </p>
    </div>

    <template v-else>
      <!-- CEO + Sanierer at the same level (parallel reporting to Owner). -->
      <div class="flex flex-col sm:flex-row items-center justify-center gap-4">
        <MemberCard
          v-if="ceo"
          :member="ceo"
          :role-label="$t('chart.role.ceo')"
          :color-class="roleColor('ceo')"
          size="lg"
          @link-agent="$emit('linkAgent', $event)"
          @spawn-agent="$emit('spawnAgent', $event)"
        />
        <MemberCard
          v-if="sanierer"
          :member="sanierer"
          :role-label="$t('chart.role.sanierer')"
          :color-class="roleColor('sanierer')"
          size="lg"
          :note="$t('chart.role.sanierer.note')"
          @link-agent="$emit('linkAgent', $event)"
          @spawn-agent="$emit('spawnAgent', $event)"
        />
      </div>

      <!-- Teamleads under CEO, each with their specialists collapsed below. -->
      <div v-if="teamleads.length > 0" class="space-y-4">
        <div v-for="tl in teamleads" :key="tl.agentEmail" class="space-y-3">
          <div class="flex justify-center">
            <MemberCard
              :member="tl"
              :role-label="$t('chart.role.teamlead')"
              :color-class="roleColor('teamlead')"
              size="lg"
              @link-agent="$emit('linkAgent', $event)"
              @spawn-agent="$emit('spawnAgent', $event)"
            />
          </div>
          <div v-if="specialistsOf(tl.agentEmail).length > 0" class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            <MemberCard
              v-for="sp in specialistsOf(tl.agentEmail)"
              :key="sp.agentEmail"
              :member="sp"
              :role-label="$t('chart.role.specialist')"
              :color-class="roleColor('specialist')"
              size="sm"
              @link-agent="$emit('linkAgent', $event)"
              @spawn-agent="$emit('spawnAgent', $event)"
            />
          </div>
        </div>
      </div>

      <!-- Specialists with no Teamlead parent — surfaced so they don't disappear. -->
      <div v-if="unassignedSpecialists.length > 0" class="space-y-2">
        <div class="text-xs text-muted text-center">
          {{ $t('chart.unassigned') }}
        </div>
        <div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          <MemberCard
            v-for="sp in unassignedSpecialists"
            :key="sp.agentEmail"
            :member="sp"
            :role-label="$t('chart.role.specialist')"
            :color-class="roleColor('specialist')"
            size="sm"
            @link-agent="$emit('linkAgent', $event)"
            @spawn-agent="$emit('spawnAgent', $event)"
          />
        </div>
      </div>

      <!-- "Other" roles bucket — anything not in the standard 4-tier
           taxonomy. v1 reserves space; future tiers slot in here. -->
      <div v-if="others.length > 0" class="space-y-2">
        <div class="text-xs text-muted text-center">
          {{ $t('chart.other') }}
        </div>
        <div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          <MemberCard
            v-for="m in others"
            :key="m.agentEmail"
            :member="m"
            :role-label="m.role"
            :color-class="roleColor(m.role)"
            size="sm"
            @link-agent="$emit('linkAgent', $event)"
            @spawn-agent="$emit('spawnAgent', $event)"
          />
        </div>
      </div>
    </template>
  </div>
</template>
