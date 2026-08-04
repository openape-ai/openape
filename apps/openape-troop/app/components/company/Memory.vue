<script setup lang="ts">
import { computed } from 'vue'
import { useOrgCrud } from '../../composables/useOrgCrud'

// Memory panel: owner-authored facts the Operator reads. company-scope reaches every
// employee; role/agent-scope is surfaced when a topic matches. Small docs ride
// inline in the prompt, big ones become reference docs fetched on demand.
const props = defineProps<{ orgId: string }>()

const { t } = useI18n()

interface Doc { id: string, scope: string, targetId: string, title: string, body: string, mode: string, updatedAt: number }

const SCOPES = computed(() => [
  { label: t('companyPanels.memory.scope.company'), value: 'company' },
  { label: t('companyPanels.memory.scope.role'), value: 'role' },
  { label: t('companyPanels.memory.scope.agent'), value: 'agent' },
])
const MODES = computed(() => [
  { label: t('companyPanels.memory.mode.auto'), value: 'auto' },
  { label: t('companyPanels.memory.mode.inline'), value: 'inline' },
  { label: t('companyPanels.memory.mode.reference'), value: 'reference' },
])

interface DocForm { scope: string, targetId: string, title: string, body: string, mode: string }

const { items, loading, error, busy, showForm, editingId, saving, formError, form, openAdd, openEdit, submit, remove } = useOrgCrud<Doc, DocForm>({
  collection: () => `/api/cockpit/orgs/${props.orgId}/memory`,
  emptyForm: () => ({ scope: 'company', targetId: '', title: '', body: '', mode: 'auto' }),
})

const scopeLabel = (s: string) => SCOPES.value.find(x => x.value === s)?.label ?? s
const modeLabel = (m: string) => MODES.value.find(x => x.value === m)?.label ?? m

function edit(d: Doc) {
  openEdit(d.id, { scope: d.scope, targetId: d.targetId, title: d.title, body: d.body, mode: d.mode })
}

async function save() {
  if (!form.title.trim() && !form.body.trim()) {
    formError.value = t('common.required', { field: t('companyPanels.field.titleOrBody') })
    return
  }
  const body: Record<string, unknown> = { scope: form.scope, targetId: form.targetId.trim(), title: form.title.trim(), body: form.body }
  if (form.mode !== 'auto') body.mode = form.mode
  await submit(body)
}
</script>

<template>
  <div>
    <div class="flex justify-between items-center mb-6">
      <p class="text-sm text-zinc-500">
        {{ t('companyPanels.memory.intro') }}
      </p>
      <UButton color="primary" icon="i-lucide-plus" @click="openAdd">
        {{ t('companyPanels.memory.addButton') }}
      </UButton>
    </div>

    <UAlert v-if="error" color="error" variant="subtle" :title="error" class="mb-4" />

    <div v-if="loading" class="text-zinc-500 py-10 text-center">
      {{ t('common.loading') }}
    </div>
    <div v-else-if="!items.length" class="text-zinc-600 italic py-10 text-center">
      {{ t('companyPanels.memory.empty') }}
    </div>
    <div v-else class="space-y-2">
      <div
        v-for="d in items"
        :key="d.id"
        class="rounded-lg border border-zinc-800 bg-zinc-900/40 p-3 cursor-pointer hover:border-zinc-700"
        @click="edit(d)"
      >
        <div class="flex items-start justify-between gap-2">
          <div class="min-w-0">
            <div class="flex items-center gap-2 flex-wrap">
              <span class="text-sm font-medium truncate">{{ d.title || t('companyPanels.memory.untitled') }}</span>
              <UBadge color="neutral" variant="subtle" size="xs">
                {{ scopeLabel(d.scope) }}{{ d.targetId ? `: ${d.targetId}` : '' }}
              </UBadge>
              <UBadge :color="d.mode === 'reference' ? 'info' : 'neutral'" variant="subtle" size="xs">
                {{ modeLabel(d.mode) }}
              </UBadge>
            </div>
            <p class="text-xs text-zinc-500 mt-1 line-clamp-2">
              {{ d.body }}
            </p>
          </div>
          <UButton color="neutral" variant="ghost" size="xs" icon="i-lucide-x" :aria-label="t('common.remove')" :loading="busy[d.id]" @click.stop="remove(d.id)" />
        </div>
      </div>
    </div>

    <UModal v-model:open="showForm" :ui="{ content: 'sm:max-w-2xl max-h-[85dvh]' }">
      <template #content>
        <div class="p-5 sm:p-6 space-y-4 overflow-y-auto">
          <div class="flex items-start justify-between">
            <h3 class="text-lg font-semibold">
              {{ editingId ? t('companyPanels.memory.form.titleEdit') : t('companyPanels.memory.form.titleNew') }}
            </h3>
            <UButton variant="ghost" size="sm" icon="i-lucide-x" :aria-label="t('common.close')" @click="showForm = false" />
          </div>
          <div class="grid grid-cols-2 gap-3">
            <UFormField :label="t('companyPanels.memory.field.scope.label')">
              <USelect v-model="form.scope" :items="SCOPES" class="w-full" />
            </UFormField>
            <UFormField v-if="form.scope !== 'company'" :label="t('companyPanels.memory.field.target.label')" :description="t('companyPanels.memory.field.target.description')">
              <UInput v-model="form.targetId" :placeholder="t('companyPanels.memory.field.target.placeholder')" class="w-full" :ui="{ base: 'w-full' }" />
            </UFormField>
          </div>
          <UFormField :label="t('companyPanels.memory.field.title.label')" :description="t('companyPanels.memory.field.title.description')">
            <UInput v-model="form.title" :placeholder="t('companyPanels.memory.field.title.placeholder')" class="w-full" :ui="{ base: 'w-full' }" />
          </UFormField>
          <UFormField :label="t('companyPanels.memory.field.body.label')">
            <UTextarea v-model="form.body" :rows="12" :placeholder="t('companyPanels.memory.field.body.placeholder')" class="w-full font-mono text-xs" :ui="{ base: 'w-full' }" />
          </UFormField>
          <UFormField :label="t('companyPanels.memory.field.mode.label')" :description="t('companyPanels.memory.field.mode.description')">
            <USelect v-model="form.mode" :items="MODES" class="w-full" />
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
