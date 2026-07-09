<script setup lang="ts">
import { computed } from 'vue'

// The company's org chart = its employees (the whole hierarchy), Owner at the
// root. Provider-agnostic: how an employee runs (Claude session, later a nest)
// is the provider's concern, not shown here.
export interface Employee { id: string, role: string, label: string, duties: string, tools: string[], enabled: boolean, reportsTo: string | null }

const props = defineProps<{ employees: Employee[], ownerEmail: string }>()
defineEmits<{ add: [], edit: [e: Employee], delete: [e: Employee], toggle: [e: Employee] }>()

const roleLabel: Record<string, string> = { ceo: 'CEO', teamlead: 'Team-Lead', specialist: 'Specialist', sanierer: 'Controlling', other: 'Mitarbeiter' }
const byId = computed(() => Object.fromEntries(props.employees.map(e => [e.id, e])))
function supervisorLabel(e: Employee): string | null {
  return e.reportsTo ? byId.value[e.reportsTo]?.label ?? null : null
}
// Parent-first ordering with a depth (roots = reportsTo null / unknown), so the
// tree indents CEO → teamleads → specialists.
const tree = computed(() => {
  const depthOf = (e: Employee, seen = new Set<string>()): number => {
    const parent = e.reportsTo ? byId.value[e.reportsTo] : undefined
    if (!parent || seen.has(e.id)) return 0
    seen.add(e.id)
    return 1 + depthOf(parent, seen)
  }
  return Array.from(props.employees, e => ({ e, depth: depthOf(e) }))
    .sort((a, b) => a.depth - b.depth || (a.e.role === 'ceo' ? -1 : 0) - (b.e.role === 'ceo' ? -1 : 0) || a.e.label.localeCompare(b.e.label))
})
</script>

<template>
  <div class="space-y-4">
    <!-- Owner — root -->
    <div class="flex justify-center">
      <div class="rounded-lg border border-amber-600/40 bg-amber-500/5 px-4 py-3 text-center min-w-[200px]">
        <div class="text-xs uppercase tracking-wide text-amber-400 font-semibold">
          Owner
        </div>
        <div class="font-mono text-sm mt-1 break-all">
          {{ ownerEmail }}
        </div>
      </div>
    </div>

    <div class="flex items-center justify-center gap-2">
      <span class="text-xs text-zinc-500">Mitarbeiter</span>
      <UButton size="xs" variant="soft" color="primary" icon="i-lucide-user-plus" @click="$emit('add')">
        Mitarbeiter
      </UButton>
    </div>

    <div v-if="employees.length" class="space-y-2 max-w-2xl mx-auto">
      <div
        v-for="{ e, depth } in tree"
        :key="e.id"
        class="rounded-lg border px-3 py-2 text-left"
        :class="[
          e.role === 'ceo' ? 'border-amber-500/50 bg-amber-500/10' : e.enabled ? 'border-violet-500/40 bg-violet-500/10' : 'border-zinc-700 bg-zinc-900/40 opacity-70',
        ]"
        :style="{ marginLeft: `${depth * 24}px` }"
      >
        <div class="flex items-center justify-between gap-2">
          <span class="text-sm font-medium truncate flex items-center gap-1.5">
            <UIcon v-if="e.role === 'ceo'" name="i-lucide-crown" class="size-4 text-amber-400" />
            <span v-else-if="depth" class="text-zinc-600">↳</span>
            {{ e.label }}
          </span>
          <UBadge :color="e.role === 'ceo' ? 'warning' : 'neutral'" variant="subtle" size="xs">
            {{ roleLabel[e.role] ?? e.role }}
          </UBadge>
        </div>
        <div v-if="supervisorLabel(e)" class="text-[11px] text-zinc-500 mt-0.5">
          berichtet an {{ supervisorLabel(e) }}
        </div>
        <p v-if="e.duties" class="text-xs text-zinc-400 mt-1 line-clamp-2">
          {{ e.duties }}
        </p>
        <div class="flex flex-wrap gap-1 mt-2">
          <UBadge v-for="t in e.tools" :key="t" color="primary" variant="subtle" size="xs">
            {{ t }}
          </UBadge>
          <span v-if="!e.tools.length" class="text-[10px] text-zinc-500">keine Werkzeuge</span>
        </div>
        <div class="flex justify-end gap-1 mt-2">
          <UButton size="xs" variant="ghost" color="neutral" icon="i-lucide-pencil" @click="$emit('edit', e)" />
          <UButton size="xs" variant="ghost" color="neutral" :icon="e.enabled ? 'i-lucide-pause' : 'i-lucide-play'" @click="$emit('toggle', e)" />
          <UButton size="xs" variant="ghost" color="error" icon="i-lucide-trash-2" @click="$emit('delete', e)" />
        </div>
      </div>
    </div>
    <p v-else class="text-center text-sm text-zinc-500">
      Noch keine Mitarbeiter — leg den CEO und sein Team an.
    </p>
  </div>
</template>
