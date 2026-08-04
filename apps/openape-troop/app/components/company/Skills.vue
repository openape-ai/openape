<script setup lang="ts">
import { computed } from 'vue'
import { useOrgCrud } from '../../composables/useOrgCrud'

// Skills panel: reusable named procedures assigned to agents. An assigned agent
// picks a skill by its description and follows the prompt (M2 fetch). Assignment
// targets: the Operator ('ceo') and/or the org's delegation agents.
const props = defineProps<{ orgId: string, agents: { id: string, role: string, label: string }[] }>()

const { t } = useI18n()

interface Skill { id: string, name: string, description: string, prompt: string, assignedTo: string[], updatedAt: number }

// The Operator is a fixed target; the rest are the (non-Operator) delegation agents.
const targetOptions = computed(() => [
  { value: 'ceo', label: t('common.role.ceo') },
  ...props.agents.filter(a => a.role !== 'ceo').map(a => ({ value: a.id, label: a.label })),
])
const targetLabel = (target: string) => targetOptions.value.find(o => o.value === target)?.label ?? target

interface SkillForm { name: string, description: string, prompt: string, assignedTo: string[] }

const { items, loading, error, busy, showForm, editingId, saving, formError, form, openAdd, openEdit, submit, remove } = useOrgCrud<Skill, SkillForm>({
  collection: () => `/api/cockpit/orgs/${props.orgId}/skills`,
  emptyForm: () => ({ name: '', description: '', prompt: '', assignedTo: [] }),
})

function edit(s: Skill) {
  openEdit(s.id, { name: s.name, description: s.description, prompt: s.prompt, assignedTo: [...s.assignedTo] })
}
function toggleTarget(value: string) {
  const i = form.assignedTo.indexOf(value)
  if (i === -1) form.assignedTo.push(value)
  else form.assignedTo.splice(i, 1)
}

async function save() {
  if (!form.name.trim()) {
    formError.value = t('common.required', { field: t('companyPanels.field.name') })
    return
  }
  await submit({ name: form.name.trim(), description: form.description.trim(), prompt: form.prompt, assignedTo: form.assignedTo })
}
</script>

<template>
  <div>
    <div class="flex justify-between items-center mb-6">
      <p class="text-sm text-zinc-500">
        {{ t('companyPanels.skills.intro') }}
      </p>
      <UButton color="primary" icon="i-lucide-plus" @click="openAdd">
        {{ t('companyPanels.skills.addButton') }}
      </UButton>
    </div>

    <UAlert v-if="error" color="error" variant="subtle" :title="error" class="mb-4" />

    <div v-if="loading" class="text-zinc-500 py-10 text-center">
      {{ t('common.loading') }}
    </div>
    <div v-else-if="!items.length" class="text-zinc-600 italic py-10 text-center">
      {{ t('companyPanels.skills.empty') }}
    </div>
    <div v-else class="space-y-2">
      <div
        v-for="s in items"
        :key="s.id"
        class="rounded-lg border border-zinc-800 bg-zinc-900/40 p-3 cursor-pointer hover:border-zinc-700"
        @click="edit(s)"
      >
        <div class="flex items-start justify-between gap-2">
          <div class="min-w-0">
            <div class="flex items-center gap-2 flex-wrap">
              <span class="text-sm font-medium truncate">{{ s.name || t('common.unnamed') }}</span>
              <UBadge v-for="target in s.assignedTo" :key="target" :color="target === 'ceo' ? 'primary' : 'neutral'" variant="subtle" size="xs">
                {{ targetLabel(target) }}
              </UBadge>
              <UBadge v-if="!s.assignedTo.length" color="warning" variant="subtle" size="xs">
                {{ t('common.unassigned') }}
              </UBadge>
            </div>
            <p class="text-xs text-zinc-500 mt-1 line-clamp-2">
              {{ s.description }}
            </p>
          </div>
          <UButton color="neutral" variant="ghost" size="xs" icon="i-lucide-x" :aria-label="t('common.remove')" :loading="busy[s.id]" @click.stop="remove(s.id)" />
        </div>
      </div>
    </div>

    <UModal v-model:open="showForm" :ui="{ content: 'sm:max-w-2xl max-h-[85dvh]' }">
      <template #content>
        <div class="p-5 sm:p-6 space-y-4 overflow-y-auto">
          <div class="flex items-start justify-between">
            <h3 class="text-lg font-semibold">
              {{ editingId ? t('companyPanels.skills.form.titleEdit') : t('companyPanels.skills.form.titleNew') }}
            </h3>
            <UButton variant="ghost" size="sm" icon="i-lucide-x" :aria-label="t('common.close')" @click="showForm = false" />
          </div>
          <UFormField :label="t('companyPanels.field.name')" :description="t('common.field.shortIdHint')">
            <UInput v-model="form.name" :placeholder="t('companyPanels.skills.field.name.placeholder')" class="w-full" :ui="{ base: 'w-full' }" />
          </UFormField>
          <UFormField :label="t('companyPanels.skills.field.description.label')" :description="t('companyPanels.skills.field.description.description')">
            <UInput v-model="form.description" :placeholder="t('companyPanels.skills.field.description.placeholder')" class="w-full" :ui="{ base: 'w-full' }" />
          </UFormField>
          <UFormField :label="t('common.field.promptLabel')" :description="t('companyPanels.skills.field.prompt.description')">
            <UTextarea v-model="form.prompt" :rows="10" :placeholder="t('companyPanels.skills.field.prompt.placeholder')" class="w-full font-mono text-xs" :ui="{ base: 'w-full' }" />
          </UFormField>
          <UFormField :label="t('companyPanels.skills.field.assignedTo.label')" :description="t('companyPanels.skills.field.assignedTo.description')">
            <div class="flex flex-wrap gap-3 pt-1">
              <label v-for="o in targetOptions" :key="o.value" class="flex items-center gap-2 cursor-pointer text-sm">
                <UCheckbox :model-value="form.assignedTo.includes(o.value)" @update:model-value="toggleTarget(o.value)" />
                {{ o.label }}
              </label>
            </div>
          </UFormField>
          <UAlert v-if="formError" color="error" variant="subtle" :title="formError" />
          <div class="flex justify-end gap-2 pt-2">
            <UButton color="neutral" variant="ghost" @click="showForm = false">
              {{ t('common.cancel') }}
            </UButton>
            <UButton color="primary" :loading="saving" @click="save">
              {{ editingId ? t('common.save') : t('common.add') }}
            </UButton>
          </div>
        </div>
      </template>
    </UModal>
  </div>
</template>
