<script setup lang="ts">
import { computed } from 'vue'

// Company hierarchy chart (B0 merge — preserves the org-chart hierarchy from the
// former openape-org app). Owner is the root; CEO + Sanierer report to the Owner
// in parallel; Teamleads sit under the CEO with their Specialists; unassigned
// specialists and other roles are surfaced so nobody disappears.

interface Member { agentEmail: string, agentName: string, role: string, status: string, persona: string | null, personaTitle?: string | null, personaIcon?: string | null, reportsToEmail: string | null }
export interface LocalAgent { id: string, role: string, label: string, duties: string, tools: string[], enabled: boolean }

const props = withDefaults(defineProps<{ members: Member[], ownerEmail: string, spawning: Record<string, string>, localAgents?: LocalAgent[] }>(), { localAgents: () => [] })
defineEmits<{ spawn: [member: Member], addLocal: [], deleteLocal: [a: LocalAgent], toggleLocal: [a: LocalAgent] }>()

const active = computed(() => props.members.filter(m => m.status !== 'retired'))
const ceo = computed(() => active.value.find(m => m.role === 'ceo') ?? null)
const sanierer = computed(() => active.value.find(m => m.role === 'sanierer') ?? null)
const teamleads = computed(() => active.value.filter(m => m.role === 'teamlead'))
function specialistsOf(email: string) {
  return active.value.filter(m => m.role === 'specialist' && m.reportsToEmail === email)
}
const unassignedSpecialists = computed(() =>
  active.value.filter(m => m.role === 'specialist' && (!m.reportsToEmail || !teamleads.value.some(tl => tl.agentEmail === m.reportsToEmail))),
)
const others = computed(() => active.value.filter(m => !['ceo', 'sanierer', 'teamlead', 'specialist'].includes(m.role)))

const roleLabel = { ceo: 'CEO', sanierer: 'Controlling', teamlead: 'Team-Lead', specialist: 'Specialist', other: 'Mitglied' } as const
const roleLabelOf = (role: string): string => (roleLabel as Record<string, string>)[role] ?? role
function roleColor(role: string): string {
  switch (role) {
    case 'ceo': return 'bg-amber-500/15 text-amber-200 border-amber-500/40'
    case 'sanierer': return 'bg-red-500/15 text-red-200 border-red-500/40'
    case 'teamlead': return 'bg-blue-500/15 text-blue-200 border-blue-500/40'
    case 'specialist': return 'bg-emerald-500/15 text-emerald-200 border-emerald-500/40'
    default: return 'bg-zinc-500/15 text-zinc-200 border-zinc-500/40'
  }
}
</script>

<template>
  <div class="space-y-6">
    <!-- Owner — root of the chart -->
    <div class="flex justify-center">
      <div class="rounded-lg border border-amber-600/40 bg-amber-500/5 px-4 py-3 text-center min-w-[180px]">
        <div class="text-xs uppercase tracking-wide text-amber-400 font-semibold">
          Owner
        </div>
        <div class="font-mono text-sm mt-1 break-all">
          {{ ownerEmail }}
        </div>
      </div>
    </div>

    <div v-if="!active.length" class="rounded-lg border border-dashed border-zinc-700 p-8 text-center text-zinc-400">
      <div class="text-4xl mb-2">
        👔
      </div>
      <p class="text-sm">
        Noch keine Mitglieder. Über „Mitglied“ einen CEO anlegen.
      </p>
    </div>

    <template v-else>
      <!-- CEO + Sanierer — parallel under the Owner -->
      <div class="flex flex-col sm:flex-row items-center justify-center gap-4">
        <CompanyChartNode
          v-if="ceo"
          :member="ceo"
          :role-label="roleLabel.ceo"
          :color-class="roleColor('ceo')"
          size="lg"
          primary
          :spawning-text="spawning[ceo.agentEmail]"
          @spawn="$emit('spawn', $event)"
        />
        <CompanyChartNode
          v-if="sanierer"
          :member="sanierer"
          :role-label="roleLabel.sanierer"
          :color-class="roleColor('sanierer')"
          size="lg"
          :spawning-text="spawning[sanierer.agentEmail]"
          @spawn="$emit('spawn', $event)"
        />
      </div>

      <!-- Teamleads under CEO, with their specialists -->
      <div v-if="teamleads.length" class="space-y-4">
        <div v-for="tl in teamleads" :key="tl.agentEmail" class="space-y-3">
          <div class="flex justify-center">
            <CompanyChartNode
              :member="tl"
              :role-label="roleLabel.teamlead"
              :color-class="roleColor('teamlead')"
              size="lg"
              :spawning-text="spawning[tl.agentEmail]"
              @spawn="$emit('spawn', $event)"
            />
          </div>
          <div v-if="specialistsOf(tl.agentEmail).length" class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            <CompanyChartNode
              v-for="sp in specialistsOf(tl.agentEmail)"
              :key="sp.agentEmail"
              :member="sp"
              :role-label="roleLabel.specialist"
              :color-class="roleColor('specialist')"
              size="sm"
              :spawning-text="spawning[sp.agentEmail]"
              @spawn="$emit('spawn', $event)"
            />
          </div>
        </div>
      </div>

      <!-- Specialists without a teamlead -->
      <div v-if="unassignedSpecialists.length" class="space-y-2">
        <div class="text-xs text-zinc-500 text-center">
          Ohne Team-Lead
        </div>
        <div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          <CompanyChartNode
            v-for="sp in unassignedSpecialists"
            :key="sp.agentEmail"
            :member="sp"
            :role-label="roleLabel.specialist"
            :color-class="roleColor('specialist')"
            size="sm"
            :spawning-text="spawning[sp.agentEmail]"
            @spawn="$emit('spawn', $event)"
          />
        </div>
      </div>

      <!-- Other roles -->
      <div v-if="others.length" class="space-y-2">
        <div class="text-xs text-zinc-500 text-center">
          Weitere
        </div>
        <div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          <CompanyChartNode
            v-for="m in others"
            :key="m.agentEmail"
            :member="m"
            :role-label="roleLabelOf(m.role)"
            :color-class="roleColor(m.role)"
            size="sm"
            :spawning-text="spawning[m.agentEmail]"
            @spawn="$emit('spawn', $event)"
          />
        </div>
      </div>
    </template>

    <!-- Local (nest-less) roles: run by the reactive loop under the Owner's identity -->
    <div class="space-y-2 border-t border-zinc-800/70 pt-5">
      <div class="flex items-center justify-center gap-2">
        <span class="text-xs text-zinc-500">Lokale Rollen · kein Nest</span>
        <UButton size="xs" variant="soft" color="primary" icon="i-lucide-plus" @click="$emit('addLocal')">
          Lokale Rolle
        </UButton>
      </div>
      <p class="text-center text-[11px] text-zinc-600">
        Läuft nicht auf einem Gerät — der CEO delegiert Aufgaben mit passendem Werkzeug an sie (read-only, unter deiner Identität).
      </p>
      <div v-if="props.localAgents.length" class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        <div
          v-for="a in props.localAgents"
          :key="a.id"
          class="rounded-lg border px-3 py-2 text-left"
          :class="a.enabled ? 'border-violet-500/40 bg-violet-500/10' : 'border-zinc-700 bg-zinc-900/40 opacity-70'"
        >
          <div class="flex items-center justify-between gap-2">
            <span class="text-sm font-medium truncate">{{ a.label }}</span>
            <UBadge color="neutral" variant="subtle" size="xs">
              lokal · {{ a.role }}
            </UBadge>
          </div>
          <p v-if="a.duties" class="text-xs text-zinc-400 mt-1 line-clamp-2">
            {{ a.duties }}
          </p>
          <div class="flex flex-wrap gap-1 mt-2">
            <UBadge v-for="t in a.tools" :key="t" color="primary" variant="subtle" size="xs">
              {{ t }}
            </UBadge>
            <span v-if="!a.tools.length" class="text-[10px] text-zinc-500">keine Werkzeuge</span>
          </div>
          <div class="flex justify-end gap-1 mt-2">
            <UButton size="xs" variant="ghost" color="neutral" :icon="a.enabled ? 'i-lucide-pause' : 'i-lucide-play'" @click="$emit('toggleLocal', a)" />
            <UButton size="xs" variant="ghost" color="error" icon="i-lucide-trash-2" @click="$emit('deleteLocal', a)" />
          </div>
        </div>
      </div>
      <p v-else class="text-center text-xs text-zinc-600">
        Noch keine lokalen Rollen.
      </p>
    </div>
  </div>
</template>
