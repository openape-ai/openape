<script setup lang="ts">
import { computed } from 'vue'
import type { Employee, TreeNode } from './OrgNode.vue'

// The company's org chart = its employees (whole hierarchy), Owner at the root.
const props = defineProps<{ employees: Employee[], ownerEmail: string }>()
defineEmits<{ add: [], edit: [e: Employee], delete: [e: Employee], toggle: [e: Employee] }>()

const byId = computed(() => Object.fromEntries(props.employees.map(e => [e.id, e])))
function build(e: Employee, seen: Set<string>): TreeNode {
  seen.add(e.id)
  const children = props.employees
    .filter(c => c.reportsTo === e.id && !seen.has(c.id))
    .map(c => build(c, seen))
  return { e, children }
}
// Roots = report to the Owner (no supervisor, or a supervisor that no longer exists).
const roots = computed<TreeNode[]>(() => {
  const seen = new Set<string>()
  return props.employees
    .filter(e => !e.reportsTo || !byId.value[e.reportsTo])
    .map(e => build(e, seen))
})
</script>

<template>
  <div class="space-y-4">
    <div class="flex items-center justify-center gap-2">
      <span class="text-xs text-zinc-500">Organigramm</span>
      <UButton size="xs" variant="soft" color="primary" icon="i-lucide-user-plus" @click="$emit('add')">
        Mitarbeiter
      </UButton>
    </div>

    <div v-if="employees.length" class="overflow-x-auto pb-4">
      <ul class="org-tree">
        <li>
          <div class="org-card" style="border-color: color-mix(in srgb, #f59e0b 40%, transparent); background: color-mix(in srgb, #f59e0b 6%, #18181b)">
            <div class="org-role" style="color:#f59e0b">
              Owner
            </div>
            <div class="org-name" style="font-family: ui-monospace, monospace; font-size: 12px; word-break: break-all">
              {{ ownerEmail }}
            </div>
          </div>
          <ul v-if="roots.length">
            <CompanyOrgNode
              v-for="n in roots"
              :key="n.e.id"
              :node="n"
              @edit="$emit('edit', $event)"
              @delete="$emit('delete', $event)"
              @toggle="$emit('toggle', $event)"
            />
          </ul>
        </li>
      </ul>
    </div>
    <p v-else class="text-center text-sm text-zinc-500">
      Noch keine Mitarbeiter — leg den CEO und sein Team an.
    </p>
  </div>
</template>
