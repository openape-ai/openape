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
}

const props = defineProps<{
  members: Member[]
  ownerEmail: string
}>()

// `retire` event reserved for a future inline-retire button (currently
// the member-management UI lives in AddMemberDialog only). Underscore
// prefix silences the unused-vars lint until the button lands.
defineEmits<{ retire: [email: string] }>()

const { t } = useI18n()

// Active = currently part of the org. Retired rows live in the data
// for audit but aren't drawn on the chart.
const active = computed(() => props.members.filter(m => m.status !== 'retired'))

const ceo = computed(() => active.value.find(m => m.role === 'ceo') ?? null)
const sanierer = computed(() => active.value.find(m => m.role === 'sanierer') ?? null)
const teamleads = computed(() => active.value.filter(m => m.role === 'teamlead'))
function specialistsOf(teamleadEmail: string) {
  return active.value.filter(m => m.role === 'specialist' && m.reportsToEmail === teamleadEmail)
}
const unassignedSpecialists = computed(() =>
  active.value.filter(m => m.role === 'specialist' && (!m.reportsToEmail || !teamleads.value.some(t => t.agentEmail === m.reportsToEmail))),
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

function statusBadge(s: string): { color: 'success' | 'warning' | 'neutral', label: string } {
  if (s === 'active') return { color: 'success', label: t('chart.status.active') }
  if (s === 'invited') return { color: 'warning', label: t('chart.status.invited') }
  return { color: 'neutral', label: s }
}
</script>

<template>
  <div class="space-y-6">
    <!-- Owner card — always shown at top, not a member row but the
         root of the chart. -->
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

    <!-- Empty state — no members yet. The dotted lines hint at the
         intended structure so the Owner sees what they're about to
         build. -->
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
      <!-- CEO row — single, centered. Sanierer sits beside it on the
           same level (parallel reporting to Owner). -->
      <div class="flex flex-col sm:flex-row items-center justify-center gap-4">
        <div v-if="ceo" class="rounded-lg border px-4 py-3 min-w-[180px] text-center" :class="[roleColor('ceo')]">
          <div class="text-xs uppercase tracking-wide font-semibold">
            {{ $t('chart.role.ceo') }}
          </div>
          <div class="font-mono text-sm mt-1 break-all">
            {{ ceo.agentName }}
          </div>
          <UBadge :color="statusBadge(ceo.status).color" variant="subtle" size="xs" class="mt-2">
            {{ statusBadge(ceo.status).label }}
          </UBadge>
        </div>

        <div v-if="sanierer" class="rounded-lg border px-4 py-3 min-w-[180px] text-center relative" :class="[roleColor('sanierer')]">
          <div class="text-xs uppercase tracking-wide font-semibold">
            {{ $t('chart.role.sanierer') }}
          </div>
          <div class="font-mono text-sm mt-1 break-all">
            {{ sanierer.agentName }}
          </div>
          <UBadge :color="statusBadge(sanierer.status).color" variant="subtle" size="xs" class="mt-2">
            {{ statusBadge(sanierer.status).label }}
          </UBadge>
          <div class="text-[10px] text-muted mt-1">
            {{ $t('chart.role.sanierer.note') }}
          </div>
        </div>
      </div>

      <!-- Teamleads under CEO. Each Teamlead-card collapses its
           specialists below it. -->
      <div v-if="teamleads.length > 0" class="space-y-4">
        <div v-for="tl in teamleads" :key="tl.agentEmail" class="space-y-3">
          <div class="flex justify-center">
            <div class="rounded-lg border px-4 py-3 min-w-[180px] text-center" :class="[roleColor('teamlead')]">
              <div class="text-xs uppercase tracking-wide font-semibold">
                {{ $t('chart.role.teamlead') }}
              </div>
              <div class="font-mono text-sm mt-1 break-all">
                {{ tl.agentName }}
              </div>
              <UBadge :color="statusBadge(tl.status).color" variant="subtle" size="xs" class="mt-2">
                {{ statusBadge(tl.status).label }}
              </UBadge>
            </div>
          </div>

          <div v-if="specialistsOf(tl.agentEmail).length > 0" class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            <div
              v-for="sp in specialistsOf(tl.agentEmail)"
              :key="sp.agentEmail"
              class="rounded-lg border px-3 py-2 text-center" :class="[roleColor('specialist')]"
            >
              <div class="text-[10px] uppercase tracking-wide font-semibold opacity-70">
                {{ $t('chart.role.specialist') }}
              </div>
              <div class="font-mono text-xs mt-0.5 break-all">
                {{ sp.agentName }}
              </div>
              <UBadge :color="statusBadge(sp.status).color" variant="subtle" size="xs" class="mt-1.5">
                {{ statusBadge(sp.status).label }}
              </UBadge>
            </div>
          </div>
        </div>
      </div>

      <!-- Specialists without a Teamlead parent — surface them so they
           don't disappear; usually a hint that the Owner needs to set
           a reports_to_email. -->
      <div v-if="unassignedSpecialists.length > 0" class="space-y-2">
        <div class="text-xs text-muted text-center">
          {{ $t('chart.unassigned') }}
        </div>
        <div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          <div
            v-for="sp in unassignedSpecialists"
            :key="sp.agentEmail"
            class="rounded-lg border px-3 py-2 text-center" :class="[roleColor('specialist')]"
          >
            <div class="text-[10px] uppercase tracking-wide font-semibold opacity-70">
              {{ $t('chart.role.specialist') }}
            </div>
            <div class="font-mono text-xs mt-0.5 break-all">
              {{ sp.agentName }}
            </div>
            <UBadge :color="statusBadge(sp.status).color" variant="subtle" size="xs" class="mt-1.5">
              {{ statusBadge(sp.status).label }}
            </UBadge>
          </div>
        </div>
      </div>

      <!-- "Other" roles bucket — anything not in the standard 4-tier
           taxonomy. v1 reserves space, future tiers slot in here. -->
      <div v-if="others.length > 0" class="space-y-2">
        <div class="text-xs text-muted text-center">
          {{ $t('chart.other') }}
        </div>
        <div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          <div
            v-for="m in others"
            :key="m.agentEmail"
            class="rounded-lg border px-3 py-2 text-center" :class="[roleColor(m.role)]"
          >
            <div class="text-[10px] uppercase tracking-wide font-semibold opacity-70">
              {{ m.role }}
            </div>
            <div class="font-mono text-xs mt-0.5 break-all">
              {{ m.agentName }}
            </div>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>
